# ==========================================
# Unitale AI 后端主应用
# 整合 FastAPI 动态端点（音效扩展）+ 静态文件服务
# 端口：8080（与前端共端口，避免跨域问题）
# Phase 9 重构：exec() 注入改成正经 import + include_router
# ==========================================

import os
import re
import time
import json
import uvicorn
import httpx
from fastapi import FastAPI, HTTPException, Form, UploadFile, File, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

import backend_sfx_extension as ext  # 正经 import，APIRouter 模式

app = FastAPI(title="Unitale AI Backend", version="1.5")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 挂载音效扩展端点（/v1/sfx/*）
app.include_router(ext.router)

# 仅代理本地 IndexTTS2 兼容服务，云端 TTS 配置仍由前端按原 URL 直连。
_LOCAL_TTS_BASE_URL = "http://127.0.0.1:8300"
_LOCAL_TTS_ALLOWED_PREFIXES = ("/health", "/v1/", "/v2/synthesize")

# 本地 TTS 上游会拿 text 字段拼输出文件名，含 " 。 等字符会触发 LibsndfileError。
# 仅在 local_tts_proxy 里清洗 body.text，云端直连不经过这里，互不影响。
_TTS_TEXT_SANITIZE_RE = re.compile(r'["\*:<>|?\\/]|[\u3002\u3001\uff01\uff1f]')


def _sanitize_tts_text(text: str) -> str:
    """清掉上游文件名不允许的字符，但保留语义内容（中文、字母、数字、常见标点）。"""
    if not isinstance(text, str):
        return text
    cleaned = _TTS_TEXT_SANITIZE_RE.sub('', text)
    # 折叠多余空白，避免文件名出现连续空格
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    return cleaned or 'tts'


def _sanitize_tts_body(body: bytes, content_type: str) -> bytes:
    """对 JSON body 中的 text 字段做清洗。非 JSON 或无 text 字段则原样返回。"""
    if not body or 'application/json' not in (content_type or ''):
        return body
    try:
        data = json.loads(body)
    except (json.JSONDecodeError, ValueError):
        return body
    if not isinstance(data, dict) or 'text' not in data:
        return body
    data['text'] = _sanitize_tts_text(data['text'])
    return json.dumps(data, ensure_ascii=False).encode('utf-8')


@app.api_route("/local-tts/{path:path}", methods=["GET", "POST", "OPTIONS"])
async def local_tts_proxy(path: str, request: Request):
    target_path = "/" + path
    if not any(target_path == prefix or target_path.startswith(prefix) for prefix in _LOCAL_TTS_ALLOWED_PREFIXES):
        raise HTTPException(status_code=404, detail="本地 TTS 代理不允许此路径")

    target = f"{_LOCAL_TTS_BASE_URL}{target_path}"
    if request.url.query:
        target += f"?{request.url.query}"

    raw_body = await request.body()
    content_type = request.headers.get('content-type', '')
    # 仅对 synthesize / qwen.design 这类带 text 字段的请求清洗
    needs_sanitize = target_path.endswith('/v2/synthesize') or target_path.endswith('/v1/qwen/design')
    body = _sanitize_tts_body(raw_body, content_type) if needs_sanitize else raw_body
    headers = {
        key: value for key, value in request.headers.items()
        if key.lower() in {"content-type", "accept"}
    }
    if needs_sanitize and body is not raw_body:
        headers['content-type'] = 'application/json'
    async with httpx.AsyncClient(trust_env=False, timeout=None) as client:
        upstream = await client.request(request.method, target, content=body, headers=headers)

    response_headers = {
        key: value for key, value in upstream.headers.items()
        if key.lower() not in {"content-length", "transfer-encoding", "connection"}
    }
    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        headers=response_headers,
        media_type=upstream.headers.get("content-type"),
    )

# ========== 音色落盘与文件夹打开功能 ==========
_STATIC_DIR = os.path.dirname(os.path.abspath(__file__))
_DEFAULT_TIMBRE_SAVE_DIR = os.path.join(_STATIC_DIR, "timbres")

# 描述中的标点/空格统一替换为下划线；文件系统非法字符直接删除
_DESC_REPLACE_RE = re.compile(r'[，,。·、；;：: \t]+')
_DESC_STRIP_RE = re.compile(r'[\\/?:*"<>|]+')

def _sanitize_description(desc: str) -> str:
    """把音色描述清理成可以用作文件名的安全字符串"""
    cleaned = _DESC_REPLACE_RE.sub('_', desc or '')
    cleaned = _DESC_STRIP_RE.sub('', cleaned)
    cleaned = cleaned.strip(' _-')
    return cleaned

def _safe_filename(name: str, ext: str, save_dir: str) -> str:
    """同名时自动加 (1) (2) 直到不冲突"""
    base = f"{name}{ext}"
    full = os.path.join(save_dir, base)
    if not os.path.exists(full):
        return base
    counter = 1
    while True:
        candidate = f"{name}({counter}){ext}"
        if not os.path.exists(os.path.join(save_dir, candidate)):
            return candidate
        counter += 1

@app.get("/v1/timbre/default_save_dir")
async def get_default_timbre_save_dir():
    """返回默认音色保存目录（后端同级 timbres/）。前端用此初始化输入框。"""
    return {"code": 200, "default_dir": _DEFAULT_TIMBRE_SAVE_DIR}

@app.post("/v1/timbre/save_to_disk")
async def save_timbre_to_disk(
    file: UploadFile = File(...),
    timbre_name: str = Form(""),
    description: str = Form(""),
    is_tts: str = Form("false"),
    save_dir: str = Form(""),
    original_filename: str = Form(None),
):
    """把前端传来的音色 blob 落盘到指定目录，按来源命名规则生成文件名。

    - TTS 生成（is_tts=true）：{音色名}_{描述清理}_{时间戳}.wav
    - 用户上传（is_tts=false）：保留原始文件名，同名自动加 (1)、(2)
    返回 {code:200, path, filename} 供前端调用 open_folder 打开并选中。
    """
    try:
        target_dir = save_dir.strip() if save_dir and save_dir.strip() else _DEFAULT_TIMBRE_SAVE_DIR
        os.makedirs(target_dir, exist_ok=True)

        raw_bytes = await file.read()
        if not raw_bytes:
            raise HTTPException(status_code=400, detail="上传的音色文件为空")

        # 决定文件名
        timestamp = time.strftime('%Y%m%d_%H%M%S', time.localtime())
        is_tts_flag = str(is_tts).lower() == 'true'

        if is_tts_flag:
            safe_name = (timbre_name or 'timbre').strip()
            safe_desc = _sanitize_description(description or '')
            if safe_desc:
                base_name = f"{safe_name}_{safe_desc}_{timestamp}"
            else:
                base_name = f"{safe_name}_{timestamp}"
            filename = _safe_filename(base_name, '.wav', target_dir)
        else:
            # 用户上传：保留原名
            raw_name = original_filename or file.filename or 'timbre.wav'
            # 切分 name/ext，保留原扩展名
            root, ext = os.path.splitext(raw_name)
            if not ext:
                ext = '.wav'
            # 防止路径逃逸/绝对路径
            root = os.path.basename(root) or 'timbre'
            filename = _safe_filename(root, ext, target_dir)

        full_path = os.path.join(target_dir, filename)
        with open(full_path, 'wb') as f:
            f.write(raw_bytes)

        return {"code": 200, "path": full_path, "filename": filename, "msg": "音色已落盘"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"音色落盘失败: {str(e)}")

@app.get("/v1/system/open_folder")
async def open_folder(path: str, select: bool = False):
    """在系统文件管理器中打开文件夹或文件所在目录。

    select=true 且 Windows 下，使用 explorer.exe /select,"path" 打开并选中文件。
    select=false 或非 Windows 下，直接打开所在目录。
    """
    if not path:
        raise HTTPException(status_code=400, detail="路径不能为空")
    target = path
    if os.path.isfile(target):
        target_dir = os.path.dirname(target)
    else:
        target_dir = target
    if not os.path.exists(target_dir):
        raise HTTPException(status_code=404, detail=f"路径不存在: {target_dir}")
    try:
        import platform, subprocess
        system = platform.system()
        if select and os.path.isfile(path) and system == "Windows":
            # Windows 下定位并选中文件
            subprocess.Popen(f'explorer.exe /select,"{os.path.normpath(path)}"', shell=True)
        elif system == "Windows":
            os.startfile(target_dir)
        elif system == "Darwin":
            os.system(f"open '{target_dir}'")
        else:
            os.system(f"xdg-open '{target_dir}'")
        return {"code": 200, "msg": "已尝试打开文件夹"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"打开文件夹失败: {str(e)}")

# 静态文件服务（前端 index.html 等放在 repo 根目录）


# StaticFiles 在部分 Python 版本中会把 .mjs 当作 text/plain 返回，
# 浏览器的动态 import 会因此拒绝执行。显式声明 JavaScript MIME 类型。
@app.get("/unitale_logic.mjs")
async def unitale_logic_module():
    return FileResponse(
        os.path.join(_STATIC_DIR, "unitale_logic.mjs"),
        media_type="text/javascript"
    )

app.mount("/", StaticFiles(directory=_STATIC_DIR, html=True), name="static")

if __name__ == "__main__":
    print("=" * 50)
    print("  Unitale AI Backend")
    print("  http://localhost:8080")
    print("=" * 50)
    uvicorn.run(app, host="0.0.0.0", port=8080)
