import json
import os
import sys
import traceback

PREFIX = "@@INDEXTTS@@"

def emit(payload):
    print(PREFIX + json.dumps(payload, ensure_ascii=False), flush=True)

def main():
    model_dir = os.environ["INDEXTTS_MODEL_DIR"]
    device = os.environ.get("INDEXTTS_DEVICE", "cuda:0")
    cfg_path = os.path.join(model_dir, "config.yaml")
    legacy = os.path.exists(os.path.join(model_dir, "bigvgan_generator.pth"))
    if legacy:
        from indextts.infer import IndexTTS
        tts = IndexTTS(
            cfg_path=cfg_path,
            model_dir=model_dir,
            use_fp16=device.startswith("cuda"),
            device=device,
            use_cuda_kernel=False,
        )
    else:
        from indextts.infer_v2_5 import IndexTTS2
        tts = IndexTTS2(
            cfg_path=cfg_path,
            model_dir=model_dir,
            use_bf16=device.startswith("cuda"),
            device=device,
            use_cuda_kernel=False,
            use_deepspeed=False,
            use_accel=False,
            use_torch_compile=False,
            use_qwen_emo=False,
        )
    emit({"type": "ready", "device": device, "variant": "1.5" if legacy else "2.5"})
    for line in sys.stdin:
        if not line.strip():
            continue
        req = None
        try:
            req = json.loads(line)
            if legacy:
                tts.infer(req["voice"], req["text"], req["output"], verbose=False)
            else:
                tts.infer(
                    spk_audio_prompt=req["voice"],
                    text=req["text"],
                    output_path=req["output"],
                    lang=req.get("lang", "ZH"),
                    verbose=False,
                )
            emit({"type": "result", "id": req["id"], "path": req["output"]})
        except Exception as exc:
            emit({"type": "error", "id": req.get("id") if isinstance(req, dict) else None, "error": str(exc), "trace": traceback.format_exc()[-2000:]})

if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        emit({"type": "fatal", "error": str(exc), "trace": traceback.format_exc()[-3000:]})
        raise
