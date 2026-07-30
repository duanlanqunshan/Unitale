import io, os, gc, torch, hashlib, traceback, uvicorn, sys, multiprocessing, time, subprocess
import soundfile as sf
from typing import Optional, List
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from starlette.middleware.base import BaseHTTPMiddleware
import queue

# ==========================================
# 0. 系统配置
# ==========================================
os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True,max_split_size_mb:128"

# 永久持久化路径适配 (修改为 /workspace 目录，防止重启丢失)
WORKSPACE_DIR = "/workspace"
os.makedirs(WORKSPACE_DIR, exist_ok=True)

QWEN_LIBS = "/app/qwen_libs"

# Qwen 模型路径优先指向持久化目录
QWEN_MODEL_WORKSPACE = os.path.join(WORKSPACE_DIR, "qwen3-voicedesign", "Qwen3-TTS-12Hz-1.7B-VoiceDesign")
QWEN_MODEL_DEFAULT = "/app/qwen3-voicedesign/models/Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign"
QWEN_MODEL_ALT = "/app/qwen3-voicedesign/Qwen3-TTS-12Hz-1.7B-VoiceDesign"

if os.path.exists(QWEN_MODEL_WORKSPACE):
    QWEN_MODEL = QWEN_MODEL_WORKSPACE
elif os.path.exists(QWEN_MODEL_DEFAULT):
    QWEN_MODEL = QWEN_MODEL_DEFAULT
else:
    QWEN_MODEL = QWEN_MODEL_ALT

PROMPTS_DIR = os.path.abspath("prompts")
os.makedirs(PROMPTS_DIR, exist_ok=True)

app = FastAPI(title="Super Unitale Smart API")

class ForceCORS(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        if request.method == "OPTIONS":
            return Response(status_code=200, headers={
                "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "*",
                "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Credentials": "false",
            })
        response = await call_next(request)
        response.headers["Access-Control-Allow-Origin"] = "*"
        return response

app.add_middleware(ForceCORS)

def hash_filename(filename: str) -> str:
    ext = os.path.splitext(filename)[1] or ".wav"
    h = hashlib.md5(filename.encode("utf-8")).hexdigest()
    return f"{h}{ext}"

# ==========================================
# 1. Qwen3 守护进程逻辑
# ==========================================
def qwen_daemon(input_q, output_q):
    model = None
    try:
        sys.path.insert(0, QWEN_LIBS)
        import torch
        import sox
        from qwen_tts.inference.qwen3_tts_model import Qwen3TTSModel
        
        print(f"🟢 [Qwen Daemon] 子进程启动 (PID: {os.getpid()})，正在加载模型...")
        torch.cuda.empty_cache()
        
        model = Qwen3TTSModel.from_pretrained(
            QWEN_MODEL, 
            device_map="cuda:0", 
            dtype=torch.bfloat16, 
            local_files_only=True
        )
        print(f"🟢 [Qwen Daemon] 模型加载完毕，等待指令...")
        
        while True:
            try:
                task = input_q.get(timeout=1) 
            except queue.Empty:
                continue

            if task.get("command") == "STOP":
                print("🔴 [Qwen Daemon] 收到停止指令，正在退出...")
                break
            
            if task.get("command") == "DESIGN":
                try:
                    print(f"🔵 [Qwen Daemon] 开始处理音色合成任务...")
                    req_dict = task["data"]
                    wavs, sr = model.generate_voice_design(
                        text=req_dict.get("text", "预览"),
                        language="Chinese",
                        instruct=req_dict["voice_description"]
                    )
                    
                    audio_data = wavs[0].cpu().numpy() if hasattr(wavs[0], "cpu") else wavs[0]
                    buf = io.BytesIO()
                    sf.write(buf, audio_data, sr, format="WAV")
                    buf.seek(0)
                    
                    output_q.put({"success": True, "audio_bytes": buf.read()})
                    print(f"🔵 [Qwen Daemon] 任务完成")
                except Exception as e:
                    traceback.print_exc()
                    output_q.put({"success": False, "error": str(e)})
                    
    except Exception as e:
        print(f"❌ [Qwen Daemon] 致命错误: {e}")
        traceback.print_exc()
    finally:
        if model: del model
        gc.collect()
        torch.cuda.empty_cache()
        print("🔴 [Qwen Daemon] 进程销毁，显存释放")

# ==========================================
# 2. 全局模型管理器 (精准白名单版)
# ==========================================
class ModelManager:
    def __init__(self):
        self.indextts = None
        self.qwen_process: Optional[multiprocessing.Process] = None
        self.qwen_in_q: Optional[multiprocessing.Queue] = None
        self.qwen_out_q: Optional[multiprocessing.Queue] = None
        self.lock = multiprocessing.Lock()
        
        self.main_pid = os.getpid()
        
        if multiprocessing.current_process().name == 'MainProcess':
            self._init_resident_model()

    def _init_resident_model(self):
        print(f"[启动] 主进程 PID: {self.main_pid}")
        print("[启动] 正在载入 IndexTTS2...")
        
        # 优先使用 /workspace 下的持久化模型路径
        checkpoints_dir = os.path.join(WORKSPACE_DIR, "checkpoints")
        if os.path.exists(os.path.join(checkpoints_dir, "config.yaml")):
            model_dir_path = checkpoints_dir
            cfg_file_path = os.path.join(checkpoints_dir, "config.yaml")
        else:
            model_dir_path = "checkpoints"
            cfg_file_path = "checkpoints/config.yaml"

        from indextts.infer_v2 import IndexTTS2
        self.indextts = IndexTTS2(
            model_dir=model_dir_path,
            cfg_path=cfg_file_path
        )
        print(f"✅ IndexTTS2 就绪 (路径: {model_dir_path})。")

    def _kill_zombies(self):
        try:
            cmd = "ps -eo pid,args | grep python"
            output = subprocess.check_output(cmd, shell=True, encoding='utf-8')
            
            for line in output.strip().split('\n'):
                if not line: continue
                parts = line.strip().split(maxsplit=1)
                if len(parts) < 2: continue
                
                try:
                    pid = int(parts[0])
                    cmdline = parts[1]
                except ValueError:
                    continue

                if pid == self.main_pid: continue
                if self.qwen_process and self.qwen_process.is_alive() and pid == self.qwen_process.pid: continue
                if "resource_tracker" in cmdline: continue
                if "grep" in cmdline or "ps -eo" in cmdline: continue

                print(f"💀 [内部清洗] 发现未知 Python 进程 PID: {pid} ({cmdline[:15]}...)，执行清理...")
                try:
                    os.kill(pid, 9)
                except Exception:
                    pass
        except Exception:
            pass

    def ensure_qwen_loaded(self):
        if self.qwen_process is not None and self.qwen_process.is_alive():
            return 

        print("🟡 [调度器] 准备启动 Qwen3...")
        self._kill_zombies() 
        
        print("🧹 [调度器] 正在压缩 IndexTTS 显存碎片...")
        torch.cuda.empty_cache()
        gc.collect()

        print("🟡 [调度器] 拉起 Qwen3 守护进程...")
        self.qwen_in_q = multiprocessing.Queue()
        self.qwen_out_q = multiprocessing.Queue()
        self.qwen_process = multiprocessing.Process(
            target=qwen_daemon, 
            args=(self.qwen_in_q, self.qwen_out_q),
            daemon=True
        )
        self.qwen_process.start()

    def unload_qwen(self):
        if self.qwen_process is not None and self.qwen_process.is_alive():
            print("⚠️ [调度器] 正在卸载 Qwen3...")
            try:
                self.qwen_in_q.put({"command": "STOP"})
                self.qwen_process.join(timeout=3)
                if self.qwen_process.is_alive():
                    self.qwen_process.terminate()
                    self.qwen_process.join()
            except Exception:
                pass
            
            self.qwen_process = None
            self.qwen_in_q = None
            self.qwen_out_q = None
            torch.cuda.empty_cache()
            print("✅ [调度器] Qwen3 已卸载")

manager = ModelManager()

# ==========================================
# 3. 接口定义
# ==========================================
class TextToSpeechRequest(BaseModel):
    text: str 
    audio_path: str 
    emo_text: Optional[str] = None
    emo_vector: Optional[List[float]] = Field(None, min_items=8, max_items=8)

class QwenDesignRequest(BaseModel):
    voice_description: str
    text: str = "这是生成的参考音频预览。"
    save_as: Optional[str] = "designed_voice.wav" 

@app.post("/v1/upload_audio")
async def upload_audio(audio: UploadFile = File(...), full_path: str = Form(...)):
    content = await audio.read()
    save_path = os.path.join(PROMPTS_DIR, hash_filename(full_path))
    with open(save_path, "wb") as f: f.write(content)
    return {"code": 200, "msg": "上传成功", "filename": full_path}

@app.get("/v1/check/audio")
async def check_audio_exists(file_name: str):
    exists = os.path.isfile(os.path.join(PROMPTS_DIR, hash_filename(file_name)))
    return {"code": 200 if exists else 404, "exists": exists}

@app.post("/v1/qwen/design")
async def qwen_design(request: QwenDesignRequest):
    with manager.lock:
        manager.ensure_qwen_loaded()
        manager.qwen_in_q.put({"command": "DESIGN", "data": request.model_dump()})
        try:
            res = manager.qwen_out_q.get(timeout=120) 
            if res.get("success"):
                return Response(content=res["audio_bytes"], media_type="audio/wav")
            else:
                raise HTTPException(status_code=500, detail=res.get("error"))
        except queue.Empty:
            manager.unload_qwen()
            raise HTTPException(status_code=500, detail="Qwen 推理超时")

@app.post("/v2/synthesize")
async def synthesize_v2(request: TextToSpeechRequest):
    manager.unload_qwen() 
    manager._kill_zombies()
    
    if manager.indextts is None: raise HTTPException(status_code=503, detail="IndexTTS2 未就绪")
    
    real_file_path = os.path.join(PROMPTS_DIR, hash_filename(request.audio_path))
    temp_out = os.path.join(PROMPTS_DIR, f"temp_synth_{time.time()}.wav")
    if not os.path.isfile(real_file_path): raise HTTPException(status_code=404, detail="音频不存在")

    try:
        manager.indextts.infer(
            spk_audio_prompt=real_file_path, text=request.text, output_path=temp_out,
            emo_vector=request.emo_vector, emo_text=request.emo_text,
            use_emo_text=bool(request.emo_text), emo_alpha=0.6
        )
        with open(temp_out, "rb") as f: data = f.read()
        if os.path.exists(temp_out): os.remove(temp_out)
        return Response(content=data, media_type="audio/wav")
    except Exception as e:
        if os.path.exists(temp_out): os.remove(temp_out)
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    multiprocessing.set_start_method('spawn', force=True)
    uvicorn.run(app, host="0.0.0.0", port=8300)