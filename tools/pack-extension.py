"""打包浏览器扩展：复制 edge/ 到 deploy/dist，按需改写默认服务器地址，输出 zip。

用法：
    python tools/pack-extension.py
    python tools/pack-extension.py --server https://sp.example.com

zip 根目录就是 manifest.json，可直接上传 Edge 加载项商店或解压后加载。
"""

import argparse
import json
import shutil
import sys
import zipfile
from pathlib import Path

DEFAULT_SERVER_LINE = 'const DEFAULT_SERVER = "http://127.0.0.1:5080";'
DEFAULT_PROD_SERVER = "http://43.142.147.244:7788"


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    edge = root / "edge"
    manifest = json.loads((edge / "manifest.json").read_text(encoding="utf-8"))
    version = manifest["version"]

    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--server",
        default=DEFAULT_PROD_SERVER,
        help="打进包里的默认服务器地址（用户仍可在侧边栏设置里改）",
    )
    parser.add_argument("--out-dir", default=str(root / "deploy" / "dist"))
    args = parser.parse_args()

    server = args.server.rstrip("/")
    if not server.startswith(("http://", "https://")):
        print("--server 必须是 http:// 或 https:// 开头", file=sys.stderr)
        return 1

    out_dir = Path(args.out_dir)
    stage = out_dir / f"extension-{version}"
    if stage.exists():
        shutil.rmtree(stage)
    shutil.copytree(edge, stage)

    sidepanel = stage / "sidepanel" / "sidepanel.js"
    text = sidepanel.read_text(encoding="utf-8")
    if DEFAULT_SERVER_LINE not in text:
        print("sidepanel.js 里找不到默认服务器常量，请确认代码是否改过", file=sys.stderr)
        return 1
    sidepanel.write_text(
        text.replace(DEFAULT_SERVER_LINE, f'const DEFAULT_SERVER = "{server}";', 1),
        encoding="utf-8",
    )

    out_dir.mkdir(parents=True, exist_ok=True)
    zip_path = out_dir / f"sp-extension-{version}.zip"
    if zip_path.exists():
        zip_path.unlink()
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(stage.rglob("*")):
            if path.is_file():
                archive.write(path, path.relative_to(stage).as_posix())

    print(f"扩展包：{zip_path}")
    print(f"默认服务器：{server}")
    print(f"文件数：{sum(1 for p in stage.rglob('*') if p.is_file())}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
