# PDF 中文字体

`createPdf` 在检测到中文/非 Latin 字符时，会嵌入本目录的：

- `NotoSansSC-Regular.otf`（Noto Sans SC SubsetOTF，SIL OFL 1.1）

来源：https://github.com/googlefonts/noto-cjk （`Sans/SubsetOTF/SC/`）

若文件缺失，在 `frontend/` 下运行：

```bash
pnpm fonts:pdf
```

加 `--force` 可强制重新下载。
