# ==========================================
# 后端音效扩展模块（APIRouter 模式，由 backend_main.py 挂载）
# 支持 Freesound 自动云检索、下载及静态文件服务
# Phase 9 重构：去除硬编码、改 APIRouter、删死端点
# ==========================================
import os
import time
import json
import hashlib
import requests
from fastapi import APIRouter, HTTPException, Form
from fastapi.responses import FileResponse

router = APIRouter(prefix="/v1/sfx", tags=["sfx"])

# 音效下载保存目录：
#   优先级：前端传的 save_dir > 环境变量 UNITALE_SFX_DIR > ~/unitale_sfx
DEFAULT_SFX_SAVE_DIR = os.environ.get("UNITALE_SFX_DIR") or os.path.expanduser("~/unitale_sfx")
os.makedirs(DEFAULT_SFX_SAVE_DIR, exist_ok=True)

# 扫描根路径持久化文件（放用户目录，避免在盘根强行建目录）
SFX_SCAN_ROOT_FILE = os.path.join(os.path.expanduser("~"), "unitale_sfx_scan_root.txt")
SFX_ALLOWED_ROOTS_FILE = os.path.join(os.path.expanduser("~"), "unitale_sfx_allowed_roots.json")

SUPPORTED_AUDIO_EXTS = (".mp3", ".wav", ".m4a", ".flac", ".ogg")

def _load_allowed_roots():
    roots = [DEFAULT_SFX_SAVE_DIR, _load_scan_root()]
    try:
        if os.path.exists(SFX_ALLOWED_ROOTS_FILE):
            with open(SFX_ALLOWED_ROOTS_FILE, "r", encoding="utf-8") as file:
                roots.extend(json.load(file))
    except Exception:
        pass
    return [os.path.realpath(root) for root in roots if root]

def _remember_allowed_root(root: str) -> None:
    roots = set(_load_allowed_roots())
    roots.add(os.path.realpath(root))
    with open(SFX_ALLOWED_ROOTS_FILE, "w", encoding="utf-8") as file:
        json.dump(sorted(roots), file, ensure_ascii=False)

def _validate_requested_root(root: str, allowed_roots=None) -> str:
    requested = os.path.realpath(root)
    trusted = allowed_roots if allowed_roots is not None else _load_allowed_roots()
    trusted = [os.path.realpath(path) for path in trusted if path]
    if requested not in trusted:
        raise ValueError("请求的音效根目录未登记")
    return requested

def _resolve_local_sfx_path(root: str, rel_path: str) -> str:
    if not rel_path or os.path.isabs(rel_path):
        raise ValueError("音效路径必须是相对路径")
    normalized_rel = rel_path.replace("\\", "/")
    if ".." in normalized_rel.split("/"):
        raise ValueError("音效路径包含目录逃逸")
    real_root = os.path.realpath(root)
    full_path = os.path.realpath(os.path.join(real_root, normalized_rel))
    if os.path.commonpath([real_root, full_path]) != real_root:
        raise ValueError("音效路径越界")
    return full_path

# ========== 扫描根路径持久化 ==========
def _load_scan_root() -> str:
    """读取持久化的扫描根路径"""
    try:
        if os.path.exists(SFX_SCAN_ROOT_FILE):
            with open(SFX_SCAN_ROOT_FILE, "r", encoding="utf-8") as f:
                return f.read().strip()
    except Exception:
        pass
    return ""

def _save_scan_root(path: str) -> None:
    """持久化扫描根路径到用户目录"""
    try:
        with open(SFX_SCAN_ROOT_FILE, "w", encoding="utf-8") as f:
            f.write(path.strip())
    except Exception as e:
        print(f"[SFX Scan] 保存 root_path 失败: {e}")

# ========== Freesound 在线检索（Phase 2，替代 Pixabay）==========
@router.post("/fetch_freesound")
async def fetch_freesound_sfx(keyword: str = Form(...), token: str = Form(None), save_dir: str = Form(None)):
    """
    自动从 Freesound 搜索并下载音效文件到 save_dir（或默认目录）。
    前端传 token，后端不存硬编码 key。
    """
    api_key = token or os.environ.get("FREESOUND_API_KEY", "")
    if not api_key:
        raise HTTPException(status_code=400, detail="缺少 Freesound API token（前端未传，且未设置环境变量 FREESOUND_API_KEY）")

    target_dir = save_dir or DEFAULT_SFX_SAVE_DIR
    try:
        os.makedirs(target_dir, exist_ok=True)
        _remember_allowed_root(target_dir)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"无法创建音效保存目录 {target_dir}: {e}")

    try:
        search_url = (
            f"https://freesound.org/apiv2/search/text/"
            f"?query={requests.utils.quote(keyword)}"
            f"&filter=duration:[0.5 TO 30.0]"
            f"&sort=rating_desc"
            f"&fields=id,name,previews,duration,tags,username"
            f"&token={api_key}"
        )
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
        resp = requests.get(search_url, headers=headers, timeout=20)
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail=f"Freesound 搜索请求失败: HTTP {resp.status_code}")

        data = resp.json()
        results = data.get("results", [])
        if not results:
            raise HTTPException(status_code=404, detail=f"Freesound 未找到关于 '{keyword}' 的音效")

        best = results[0]
        preview_url = best.get("previews", {}).get("preview-hq-mp3") or best.get("previews", {}).get("preview-lq-mp3")
        if not preview_url:
            raise HTTPException(status_code=404, detail=f"Freesound 结果没有可用预览链接: '{keyword}'")

        audio_resp = requests.get(preview_url, headers=headers, timeout=30)
        if audio_resp.status_code != 200:
            raise HTTPException(status_code=502, detail=f"下载 Freesound 预览音频失败: HTTP {audio_resp.status_code}")

        filename = f"freesound_{hashlib.md5(keyword.encode()).hexdigest()[:8]}_{keyword.replace(' ', '_')}.mp3"
        save_path = os.path.join(target_dir, filename)
        with open(save_path, "wb") as f:
            f.write(audio_resp.content)

        return {
            "code": 200,
            "filename": filename,
            "save_dir": target_dir,
            "name": best.get("name", keyword),
            "description": f"AI 自动从 Freesound 检索下载（时长: {best.get('duration', 'N/A')}s）",
            "tags": best.get("tags", []) + ["在线云端", keyword],
            "isAmbient": best.get("duration", 0) > 15  # 超过 15 秒标记为环境持续音
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ========== 扫描根路径设置/读取（Phase 3）==========
@router.post("/scan_root")
async def set_scan_root(root_path: str = Form(...)):
    """设置并持久化本地扫描根目录路径"""
    if not os.path.exists(root_path):
        raise HTTPException(status_code=404, detail=f"路径不存在: {root_path}")
    if not os.path.isdir(root_path):
        raise HTTPException(status_code=400, detail=f"不是有效目录: {root_path}")
    _save_scan_root(root_path)
    _remember_allowed_root(root_path)
    return {"code": 200, "root_path": root_path, "msg": "扫描根路径已保存"}

@router.get("/scan_root")
async def get_scan_root():
    """获取当前持久化的扫描根目录路径"""
    root = _load_scan_root()
    exists = bool(root) and os.path.exists(root)
    return {"code": 200, "root_path": root, "exists": exists}

@router.post("/allow_root")
async def allow_root(root_path: str = Form(...)):
    """把自定义音效目录预先登记为受信根，允许后续 local_file 访问。"""
    if not os.path.exists(root_path):
        raise HTTPException(status_code=404, detail=f"路径不存在: {root_path}")
    if not os.path.isdir(root_path):
        raise HTTPException(status_code=400, detail=f"不是有效目录: {root_path}")
    _remember_allowed_root(root_path)
    return {"code": 200, "root_path": root_path, "msg": "目录已登记为受信根"}

# ========== 本地扫描结果缓存（Phase 9 新增）==========
def _cache_file_path() -> str:
    return os.path.join(DEFAULT_SFX_SAVE_DIR, "_sfx_scan_cache.json")

def _build_or_load_cache(scan_root: str, ttl_seconds: int = 300):
    """带 TTL 的本地扫描缓存。缓存命中且 scan_root 一致就直接用；否则全量 walk 重建。"""
    cache_path = _cache_file_path()
    # 1. 尝试读缓存
    if os.path.exists(cache_path):
        try:
            with open(cache_path, "r", encoding="utf-8") as f:
                cache = json.load(f)
            if (time.time() - cache.get("built_at", 0) < ttl_seconds
                and cache.get("scan_root") == scan_root
                and isinstance(cache.get("items"), list)):
                return cache["items"]
        except Exception:
            pass

    # 2. 重建：全量 walk
    items = []
    for dirpath, dirnames, filenames in os.walk(scan_root):
        rel_dir = os.path.relpath(dirpath, scan_root)
        tags = [p for p in rel_dir.replace("\\", "/").split("/") if p and p != "."]
        for fname in filenames:
            ext = os.path.splitext(fname)[1].lower()
            if ext not in SUPPORTED_AUDIO_EXTS:
                continue
            clean_name = os.path.splitext(fname)[0]
            for suffix in ["_爱给网_aigei_com", "_爱给网", "_爱给"]:
                if suffix in clean_name:
                    idx = clean_name.find(suffix)
                    clean_name = clean_name[:idx] if idx > 0 else clean_name
            clean_name = clean_name.strip(" _-")
            full_path = os.path.join(dirpath, fname)
            try:
                size_mb = round(os.path.getsize(full_path) / (1024 * 1024), 2)
            except Exception:
                size_mb = 0
            items.append({
                "name": clean_name or fname,
                "filename": fname,
                "path": os.path.relpath(full_path, scan_root).replace("\\", "/"),
                "tags": tags,
                "size_mb": size_mb,
                "src": "local_scan"
            })

    # 3. 写缓存
    try:
        with open(cache_path, "w", encoding="utf-8") as f:
            json.dump({"scan_root": scan_root, "built_at": time.time(), "items": items}, f,
                      ensure_ascii=False)
    except Exception as e:
        print(f"[SFX Scan] 写缓存失败: {e}")
    return items

# ========== 本地文件夹递归扫描（Phase 3）==========
@router.post("/scan_local")
async def scan_local_sfx(root_path: str = Form(None)):
    """递归扫描本地音效文件夹。root_path 可选，未传则用持久化路径。"""
    scan_path = root_path or _load_scan_root()
    if not scan_path:
        raise HTTPException(status_code=400, detail="未设置扫描根路径，请先调用 /v1/sfx/scan_root")
    if not os.path.exists(scan_path):
        raise HTTPException(status_code=404, detail=f"扫描路径不存在: {scan_path}")

    items = _build_or_load_cache(scan_path)

    # 如果传入了新的 root_path 且与持久化不同，更新持久化
    if root_path and root_path != _load_scan_root():
        _save_scan_root(root_path)

    return {
        "code": 200,
        "root_path": scan_path,
        "total": len(items),
        "items": items
    }

# ========== 本地搜索（Phase 4）==========
@router.post("/search_local")
async def search_local_sfx(keyword: str = Form(...), root_path: str = Form(None)):
    """在本地扫描结果中按关键词模糊搜索。用缓存避免二次 walk。"""
    from difflib import SequenceMatcher
    scan_path = root_path or _load_scan_root()
    if not scan_path or not os.path.exists(scan_path):
        raise HTTPException(status_code=400, detail="未设置扫描根路径或路径已失效")

    kw = keyword.strip().lower()
    if not kw:
        raise HTTPException(status_code=400, detail="关键词不能为空")

    all_items = _build_or_load_cache(scan_path)

    scored = []
    for item in all_items:
        n = item["name"].lower()
        score = 0
        if n == kw:
            score = 100
        elif n.startswith(kw) or kw.startswith(n):
            score = 80
        elif kw in n or n in kw:
            score = 60
        elif any(kw in t or t in kw for t in item.get("tags", [])):
            score = 40
        elif kw in item["path"].lower():
            score = 20
        else:
            ratio = SequenceMatcher(None, n, kw).ratio()
            if ratio > 0.4:
                score = int(ratio * 30)
        if score > 0:
            scored.append((score, item))

    scored.sort(key=lambda x: x[0], reverse=True)
    top = [item for _, item in scored[:10]]

    return {"code": 200, "keyword": keyword, "total": len(top), "items": top}

# ========== 本地文件流（Phase 4）==========
@router.get("/local_file")
async def get_local_sfx_file(rel_path: str, root_path: str = None):
    """提供本地扫描音效文件流。query 参数 root_path 可覆盖持久化路径。"""
    scan_path = root_path or _load_scan_root()
    if not scan_path:
        raise HTTPException(status_code=400, detail="未设置扫描根路径")
    try:
        trusted_root = _validate_requested_root(scan_path)
        full_path = _resolve_local_sfx_path(trusted_root, rel_path)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    if os.path.exists(full_path):
        return FileResponse(full_path)
    raise HTTPException(status_code=404, detail="文件不存在")
