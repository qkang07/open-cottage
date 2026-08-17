require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { sanitizeToolsForMoonshot } = require('./moonshotTools');
const { applyMoonshotThinkingBody } = require('./moonshotThinking');

const app = express();
const PORT = process.env.PORT || 3111;

// CORS 跨域支持
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'anthropic-version', 'x-goog-api-key', 'X-Requested-With', 'Accept'],
  exposedHeaders: ['Content-Length', 'Content-Type'],
  maxAge: 86400
}));
app.use(express.json());

// AI Provider configurations
const providers = {
  // OpenAI
  openai: {
    target: 'https://api.openai.com',
    apiKey: process.env.OPENAI_API_KEY,
    headers: {
      'Authorization': (apiKey) => `Bearer ${apiKey}`
    }
  },

  // Anthropic (Claude)
  anthropic: {
    target: 'https://api.anthropic.com',
    apiKey: process.env.ANTHROPIC_API_KEY,
    headers: {
      'x-api-key': (apiKey) => apiKey,
      'anthropic-version': () => '2023-06-01'
    }
  },

  // Google (Gemini)
  google: {
    target: 'https://generativelanguage.googleapis.com',
    apiKey: process.env.GOOGLE_API_KEY,
    headers: {}
  },

  // 百度 (文心一言)
  baidu: {
    target: 'https://aip.baidubce.com',
    apiKey: process.env.BAIDU_API_KEY,
    secretKey: process.env.BAIDU_SECRET_KEY,
    headers: {}
  },

  // 阿里 (通义千问)
  aliyun: {
    target: 'https://dashscope.aliyuncs.com',
    apiKey: process.env.ALIYUN_API_KEY,
    headers: {
      'Authorization': (apiKey) => `Bearer ${apiKey}`
    }
  },

  // 腾讯 (混元)
  tencent: {
    target: 'https://hunyuan.tencentcloudapi.com',
    apiKey: process.env.TENCENT_API_KEY,
    secretKey: process.env.TENCENT_SECRET_KEY,
    headers: {}
  },

  // 智谱 AI (ChatGLM)
  zhipu: {
    target: 'https://open.bigmodel.cn',
    apiKey: process.env.ZHIPU_API_KEY,
    headers: {
      'Authorization': (apiKey) => `Bearer ${apiKey}`
    }
  },

  // 科大讯飞
  iflytek: {
    target: 'https://spark-api-open.xf-yun.com',
    apiKey: process.env.IFLYTEK_API_KEY,
    headers: {
      'Authorization': (apiKey) => `Bearer ${apiKey}`
    }
  },

  // DeepSeek
  deepseek: {
    target: 'https://api.deepseek.com',
    apiKey: process.env.DEEPSEEK_API_KEY,
    headers: {
      'Authorization': (apiKey) => `Bearer ${apiKey}`
    }
  },

  // 月之暗面 (Kimi)
  moonshot: {
    target: 'https://api.moonshot.cn',
    apiKey: process.env.MOONSHOT_API_KEY,
    headers: {
      'Authorization': (apiKey) => `Bearer ${apiKey}`
    }
  },

  // Groq
  groq: {
    target: 'https://api.groq.com',
    apiKey: process.env.GROQ_API_KEY,
    headers: {
      'Authorization': (apiKey) => `Bearer ${apiKey}`
    }
  },

  // Mistral
  mistral: {
    target: 'https://api.mistral.ai',
    apiKey: process.env.MISTRAL_API_KEY,
    headers: {
      'Authorization': (apiKey) => `Bearer ${apiKey}`
    }
  }
};

// Model-to-provider mapping (prefix match)
const modelProviderMap = {
  // OpenAI
  'gpt-4.1': 'openai',
  'gpt-4.1-mini': 'openai',
  'gpt-4.1-nano': 'openai',
  'gpt-4o': 'openai',
  'gpt-4o-mini': 'openai',
  'chatgpt-4o-latest': 'openai',
  'gpt-4-turbo': 'openai',
  'gpt-4': 'openai',
  'gpt-3.5-turbo': 'openai',
  'gpt-4.5-preview': 'openai',
  'o1': 'openai',
  'o1-mini': 'openai',
  'o1-preview': 'openai',
  'o3': 'openai',
  'o3-mini': 'openai',
  'o4-mini': 'openai',

  // Anthropic (Claude)
  'claude-opus-4': 'anthropic',
  'claude-sonnet-4': 'anthropic',
  'claude-haiku-4': 'anthropic',
  'claude-3-7-sonnet': 'anthropic',
  'claude-3-5-sonnet': 'anthropic',
  'claude-3-5-haiku': 'anthropic',
  'claude-3-opus': 'anthropic',
  'claude-3-sonnet': 'anthropic',
  'claude-3-haiku': 'anthropic',
  'claude-2': 'anthropic',

  // Google (Gemini)
  'gemini-2.5-pro': 'google',
  'gemini-2.5-flash': 'google',
  'gemini-2.0-flash': 'google',
  'gemini-2.0-flash-lite': 'google',
  'gemini-1.5-pro': 'google',
  'gemini-1.5-flash': 'google',

  // 阿里 (通义千问 / DashScope)
  'qwen-max': 'aliyun',
  'qwen-plus': 'aliyun',
  'qwen-turbo': 'aliyun',
  'qwen-long': 'aliyun',
  'qwen-vl-max': 'aliyun',
  'qwen-vl-plus': 'aliyun',
  'qwen3': 'aliyun',
  'qwen2.5': 'aliyun',
  'qwen2': 'aliyun',

  // DeepSeek
  'deepseek-chat': 'deepseek',
  'deepseek-reasoner': 'deepseek',

  // 月之暗面 (Moonshot / Kimi)
  'moonshot-v1': 'moonshot',
  'kimi-k2': 'moonshot',
  'kimi-k2.5': 'moonshot',
  'kimi-k2.6': 'moonshot',
  'kimi-latest': 'moonshot',
  'kimi-thinking': 'moonshot',

  // 智谱 AI (ChatGLM)
  'glm-4': 'zhipu',
  'glm-3-turbo': 'zhipu',

  // 科大讯飞 (Spark)
  'generalv3': 'iflytek',
  'generalv3.5': 'iflytek',
  'max-32k': 'iflytek',
  '4.0Ultra': 'iflytek',
  'lite': 'iflytek',
  'pro-128k': 'iflytek',

  // Groq
  'llama-4-scout': 'groq',
  'llama-3.3-70b-versatile': 'groq',
  'llama-3.1-8b-instant': 'groq',
  'llama3-70b-8192': 'groq',
  'llama3-8b-8192': 'groq',
  'mixtral-8x7b-32768': 'groq',
  'gemma2-9b-it': 'groq',

  // Mistral
  'mistral-large': 'mistral',
  'mistral-small': 'mistral',
  'mistral-medium': 'mistral',
  'codestral': 'mistral',
  'pixtral': 'mistral',
  'ministral': 'mistral',
  'open-mistral': 'mistral',
  'open-mixtral': 'mistral',
};

// Resolve provider from model name using prefix matching
function resolveProvider(model) {
  if (!model) return null;
  // Exact match first
  if (modelProviderMap[model]) return modelProviderMap[model];
  // Prefix match (longest prefix wins)
  let matched = null;
  let matchLen = 0;
  for (const [prefix, provider] of Object.entries(modelProviderMap)) {
    if (model.startsWith(prefix) && prefix.length > matchLen) {
      matched = provider;
      matchLen = prefix.length;
    }
  }
  return matched;
}

// Helper: Add API key to request headers
function addAuthHeaders(providerName, req) {
  const provider = providers[providerName];
  if (!provider) return;

  const apiKey = provider.apiKey;
  if (!apiKey) {
    throw new Error(`API key not configured for ${providerName}`);
  }

  // Add custom headers
  if (provider.headers) {
    Object.entries(provider.headers).forEach(([key, valueFn]) => {
      req.headers[key] = valueFn(apiKey);
    });
  }

  // Special handling for providers that need API key in query string
  if (providerName === 'google') {
    req.headers['x-goog-api-key'] = apiKey;
  }
}

// Create proxy for each provider
Object.entries(providers).forEach(([name, config]) => {
  const proxy = createProxyMiddleware({
    target: config.target,
    changeOrigin: true,
    secure: true,
    pathRewrite: (path, req) => {
      // Remove the /v1/provider prefix
      const newPath = path.replace(new RegExp(`^/v1/${name}`), '');
      return newPath;
    },
    onProxyReq: (proxyReq, req, res) => {
      try {
        addAuthHeaders(name, proxyReq);

        if (name === 'moonshot' && req.body && typeof req.body === 'object') {
          const patched = applyMoonshotThinkingBody(req.body);
          const bodyData = JSON.stringify(patched);
          proxyReq.setHeader('Content-Type', 'application/json');
          proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
          proxyReq.write(bodyData);
        }

        // Log request
        console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} -> ${config.target}${proxyReq.path}`);
      } catch (error) {
        console.error(`Proxy error for ${name}:`, error.message);
        res.status(500).json({ error: error.message });
      }
    },
    onProxyRes: (proxyRes, req, res) => {
      console.log(`[${new Date().toISOString()}] Response: ${proxyRes.statusCode}`);
      
      // Add CORS headers to response
      proxyRes.headers['access-control-allow-origin'] = '*';
    },
    onError: (err, req, res) => {
      console.error(`Proxy error for ${name}:`, err.message);
      res.status(502).json({ 
        error: 'Proxy Error', 
        message: err.message,
        provider: name 
      });
    }
  });

  app.use(`/v1/${name}`, proxy);
});

// Unified API endpoint - auto-resolve provider from model
app.post('/v1/chat/completions', (req, res) => {
  const { provider: explicitProvider, model } = req.body;

  // Auto-resolve provider from model, fallback to explicit provider param
  const resolvedProvider = resolveProvider(model) || explicitProvider;

  if (!resolvedProvider || !providers[resolvedProvider]) {
    return res.status(400).json({
      error: 'Cannot determine provider',
      message: model
        ? `Unknown model "${model}". Specify a known model or pass "provider" explicitly.`
        : 'Missing "model" field in request body.',
      available_providers: Object.keys(providers)
    });
  }

  // Remove provider field from body before forwarding
  const { provider: _discarded, ...forwardBody } = req.body;
  if (resolvedProvider === 'moonshot') {
    if (Array.isArray(forwardBody.tools)) {
      forwardBody.tools = sanitizeToolsForMoonshot(forwardBody.tools);
    }
    Object.assign(forwardBody, applyMoonshotThinkingBody(forwardBody));
  }
  const config = providers[resolvedProvider];

  // Build headers
  const headers = { 'Content-Type': 'application/json' };
  if (config.apiKey && config.headers) {
    Object.entries(config.headers).forEach(([key, valueFn]) => {
      headers[key] = valueFn(config.apiKey);
    });
  }
  if (resolvedProvider === 'google') {
    headers['x-goog-api-key'] = config.apiKey;
  }

  // Determine target URL
  let targetUrl;
  if (resolvedProvider === 'google') {
    targetUrl = `${config.target}/v1beta/models/${model}:generateContent`;
  } else {
    targetUrl = `${config.target}/v1/chat/completions`;
  }

  console.log(`[${new Date().toISOString()}] Unified -> ${resolvedProvider} (${model}) -> ${targetUrl}`);

  // Forward request using native fetch
  const fetchOptions = {
    method: 'POST',
    headers,
    body: JSON.stringify(forwardBody),
  };

  fetch(targetUrl, fetchOptions)
    .then(async (upstream) => {
      const contentType = upstream.headers.get('content-type') || '';
      res.status(upstream.status);

      // Stream SSE responses
      if (contentType.includes('text/event-stream') || req.body.stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        const reader = upstream.body;
        reader.pipeTo(new WritableStream({
          write(chunk) { res.write(chunk); },
          close() { res.end(); },
          abort(err) { res.end(); }
        })).catch(() => res.end());
      } else {
        res.setHeader('Content-Type', contentType);
        const data = await upstream.text();
        res.send(data);
      }
    })
    .catch((err) => {
      console.error(`Unified endpoint error (${resolvedProvider}):`, err.message);
      res.status(502).json({
        error: 'Upstream request failed',
        message: err.message,
        provider: resolvedProvider
      });
    });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    providers: Object.keys(providers),
    timestamp: new Date().toISOString() 
  });
});

// List available providers
app.get('/v1/providers', (req, res) => {
  const providerList = Object.entries(providers).map(([name, config]) => ({
    name,
    target: config.target,
    configured: !!config.apiKey
  }));
  
  res.json({ providers: providerList });
});

// List supported models and their providers
app.get('/v1/models', (req, res) => {
  const models = Object.entries(modelProviderMap).map(([model, provider]) => ({
    id: model,
    provider,
    configured: !!providers[provider]?.apiKey
  }));
  res.json({ object: 'list', data: models });
});

// Start server
app.listen(PORT, () => {
  console.log(`AI Proxy Server running on port ${PORT}`);
  console.log(`Available providers: ${Object.keys(providers).join(', ')}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});

module.exports = app;
