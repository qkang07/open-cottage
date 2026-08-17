package tlsutil

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/hex"
	"encoding/pem"
	"fmt"
	"math/big"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

const (
	localCAName       = "Open Cottage Local CA"
	caValidity        = 10 * 365 * 24 * time.Hour
	serverValidity    = 397 * 24 * time.Hour
	renewBeforeExpiry = 30 * 24 * time.Hour
)

var materialMu sync.Mutex

type caMaterial struct {
	cert     *x509.Certificate
	key      *rsa.PrivateKey
	certPath string
}

// LoadOrGenerate loads a custom certificate when configured. In auto mode it
// creates a persistent local CA and a CA-signed localhost service certificate
// under dataDir/tls, then reuses them across process restarts.
func LoadOrGenerate(certFile, keyFile, commonName, dataDir string) (*tls.Config, string, error) {
	if certFile != "" && keyFile != "" {
		cert, err := tls.LoadX509KeyPair(certFile, keyFile)
		if err != nil {
			return nil, "", err
		}
		return tlsConfig(cert), "custom certificate", nil
	}

	materialMu.Lock()
	defer materialMu.Unlock()

	cert, ca, err := ensurePersistentCertificate(dataDir, commonName)
	if err != nil {
		return nil, "", err
	}
	fingerprint := sha256.Sum256(ca.cert.Raw)
	shortFingerprint := strings.ToUpper(hex.EncodeToString(fingerprint[:6]))
	return tlsConfig(cert), fmt.Sprintf("persistent local CA (%s)", shortFingerprint), nil
}

func tlsConfig(cert tls.Certificate) *tls.Config {
	return &tls.Config{
		Certificates: []tls.Certificate{cert},
		MinVersion:   tls.VersionTLS12,
	}
}

func tlsDir(dataDir string) string {
	return filepath.Join(dataDir, "tls")
}

func LocalCAPath(dataDir string) string {
	return filepath.Join(tlsDir(dataDir), "open-cottage-local-ca.pem")
}

func ensurePersistentCertificate(dataDir, commonName string) (tls.Certificate, *caMaterial, error) {
	dir := tlsDir(dataDir)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return tls.Certificate{}, nil, fmt.Errorf("create TLS directory: %w", err)
	}

	ca, err := loadOrCreateCA(dir)
	if err != nil {
		return tls.Certificate{}, nil, err
	}

	certPath := filepath.Join(dir, "localhost-cert.pem")
	keyPath := filepath.Join(dir, "localhost-key.pem")
	if cert, ok := loadReusableServerCertificate(certPath, keyPath, ca.cert, commonName); ok {
		return cert, ca, nil
	}

	certPEM, keyPEM, err := createServerCertificate(ca, commonName)
	if err != nil {
		return tls.Certificate{}, nil, err
	}
	if err := writePair(certPath, certPEM, keyPath, keyPEM); err != nil {
		return tls.Certificate{}, nil, err
	}
	cert, err := tls.X509KeyPair(certPEM, keyPEM)
	if err != nil {
		return tls.Certificate{}, nil, fmt.Errorf("load generated service certificate: %w", err)
	}
	cert.Certificate = append(cert.Certificate, ca.cert.Raw)
	return cert, ca, nil
}

func loadOrCreateCA(dir string) (*caMaterial, error) {
	certPath := filepath.Join(dir, "open-cottage-local-ca.pem")
	keyPath := filepath.Join(dir, "open-cottage-local-ca-key.pem")
	if ca, ok := loadReusableCA(certPath, keyPath); ok {
		return ca, nil
	}

	key, err := rsa.GenerateKey(rand.Reader, 3072)
	if err != nil {
		return nil, fmt.Errorf("generate local CA key: %w", err)
	}
	serial, err := randomSerial()
	if err != nil {
		return nil, err
	}
	now := time.Now()
	tmpl := &x509.Certificate{
		SerialNumber:          serial,
		Subject:               pkix.Name{CommonName: localCAName, Organization: []string{"Open Cottage"}},
		NotBefore:             now.Add(-time.Hour),
		NotAfter:              now.Add(caValidity),
		IsCA:                  true,
		BasicConstraintsValid: true,
		MaxPathLenZero:        true,
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign | x509.KeyUsageDigitalSignature,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		return nil, fmt.Errorf("create local CA certificate: %w", err)
	}
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)})
	if err := writePair(certPath, certPEM, keyPath, keyPEM); err != nil {
		return nil, err
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		return nil, fmt.Errorf("parse generated local CA: %w", err)
	}
	return &caMaterial{cert: cert, key: key, certPath: certPath}, nil
}

func loadReusableCA(certPath, keyPath string) (*caMaterial, bool) {
	certPEM, err := os.ReadFile(certPath)
	if err != nil {
		return nil, false
	}
	keyPEM, err := os.ReadFile(keyPath)
	if err != nil {
		return nil, false
	}
	certBlock, _ := pem.Decode(certPEM)
	keyBlock, _ := pem.Decode(keyPEM)
	if certBlock == nil || keyBlock == nil {
		return nil, false
	}
	cert, err := x509.ParseCertificate(certBlock.Bytes)
	if err != nil || !cert.IsCA || time.Until(cert.NotAfter) <= renewBeforeExpiry {
		return nil, false
	}
	key, err := x509.ParsePKCS1PrivateKey(keyBlock.Bytes)
	if err != nil || cert.CheckSignature(cert.SignatureAlgorithm, cert.RawTBSCertificate, cert.Signature) != nil {
		return nil, false
	}
	publicKey, ok := cert.PublicKey.(*rsa.PublicKey)
	if !ok || key.PublicKey.N.Cmp(publicKey.N) != 0 {
		return nil, false
	}
	return &caMaterial{cert: cert, key: key, certPath: certPath}, true
}

func loadReusableServerCertificate(certPath, keyPath string, ca *x509.Certificate, commonName string) (tls.Certificate, bool) {
	cert, err := tls.LoadX509KeyPair(certPath, keyPath)
	if err != nil || len(cert.Certificate) == 0 {
		return tls.Certificate{}, false
	}
	leaf, err := x509.ParseCertificate(cert.Certificate[0])
	if err != nil || time.Until(leaf.NotAfter) <= renewBeforeExpiry || leaf.CheckSignatureFrom(ca) != nil {
		return tls.Certificate{}, false
	}
	if leaf.VerifyHostname("localhost") != nil || leaf.VerifyHostname("127.0.0.1") != nil {
		return tls.Certificate{}, false
	}
	if commonName = strings.TrimSpace(commonName); commonName != "" && leaf.VerifyHostname(commonName) != nil {
		return tls.Certificate{}, false
	}
	cert.Certificate = append(cert.Certificate, ca.Raw)
	cert.Leaf = leaf
	return cert, true
}

func createServerCertificate(ca *caMaterial, commonName string) ([]byte, []byte, error) {
	if strings.TrimSpace(commonName) == "" {
		commonName = "localhost"
	}
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return nil, nil, fmt.Errorf("generate service certificate key: %w", err)
	}
	serial, err := randomSerial()
	if err != nil {
		return nil, nil, err
	}
	dnsNames := []string{"localhost"}
	ipAddresses := []net.IP{net.ParseIP("127.0.0.1"), net.ParseIP("::1")}
	if ip := net.ParseIP(commonName); ip != nil {
		ipAddresses = append(ipAddresses, ip)
	} else if !strings.EqualFold(commonName, "localhost") {
		dnsNames = append(dnsNames, commonName)
	}
	now := time.Now()
	tmpl := &x509.Certificate{
		SerialNumber: serial,
		Subject:      pkix.Name{CommonName: commonName, Organization: []string{"Open Cottage"}},
		NotBefore:    now.Add(-time.Hour),
		NotAfter:     now.Add(serverValidity),
		KeyUsage:     x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		DNSNames:     dnsNames,
		IPAddresses:  ipAddresses,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, ca.cert, &key.PublicKey, ca.key)
	if err != nil {
		return nil, nil, fmt.Errorf("create service certificate: %w", err)
	}
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)})
	return certPEM, keyPEM, nil
}

func randomSerial() (*big.Int, error) {
	limit := new(big.Int).Lsh(big.NewInt(1), 128)
	serial, err := rand.Int(rand.Reader, limit)
	if err != nil {
		return nil, fmt.Errorf("generate certificate serial: %w", err)
	}
	return serial, nil
}

func writePair(certPath string, certPEM []byte, keyPath string, keyPEM []byte) error {
	if err := os.WriteFile(keyPath, keyPEM, 0o600); err != nil {
		return fmt.Errorf("write private key: %w", err)
	}
	if err := os.WriteFile(certPath, certPEM, 0o644); err != nil {
		return fmt.Errorf("write certificate: %w", err)
	}
	return nil
}

// TrustLocalCA attempts to add the persistent local CA to the current user's
// trust store. It is intentionally invoked only from an explicit user action.
func TrustLocalCA(dataDir, commonName string) (string, error) {
	materialMu.Lock()
	_, ca, err := ensurePersistentCertificate(dataDir, commonName)
	materialMu.Unlock()
	if err != nil {
		return "", err
	}

	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("certutil", "-user", "-addstore", "Root", ca.certPath)
	case "darwin":
		home, homeErr := os.UserHomeDir()
		if homeErr != nil {
			return "", fmt.Errorf("find user home: %w", homeErr)
		}
		keychain := filepath.Join(home, "Library", "Keychains", "login.keychain-db")
		cmd = exec.Command("security", "add-trusted-cert", "-d", "-r", "trustRoot", "-k", keychain, ca.certPath)
	case "linux":
		home, homeErr := os.UserHomeDir()
		if homeErr != nil {
			return "", fmt.Errorf("find user home: %w", homeErr)
		}
		nssDB := filepath.Join(home, ".pki", "nssdb")
		if _, statErr := os.Stat(nssDB); statErr != nil {
			return "", fmt.Errorf("Chromium NSS database not found at %s; import %s manually", nssDB, ca.certPath)
		}
		cmd = exec.Command("certutil", "-d", "sql:"+nssDB, "-A", "-t", "C,,", "-n", localCAName, "-i", ca.certPath)
	default:
		return "", fmt.Errorf("automatic user trust is not supported on %s; import %s manually", runtime.GOOS, ca.certPath)
	}

	output, err := cmd.CombinedOutput()
	if err != nil {
		detail := strings.TrimSpace(string(output))
		if detail != "" {
			return "", fmt.Errorf("install local CA: %w: %s", err, detail)
		}
		return "", fmt.Errorf("install local CA: %w", err)
	}
	return ca.certPath, nil
}
