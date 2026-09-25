import sys, os, time
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "Hunyuan3D-2"))
import torch
from hy3dgen.shapegen import Hunyuan3DDiTFlowMatchingPipeline as P
for rid, sub in (("tencent/Hunyuan3D-2", "hunyuan3d-dit-v2-0-turbo"),
                 ("tencent/Hunyuan3D-2", "hunyuan3d-dit-v2-0")):
    try:
        t = time.time()
        pipe = P.from_pretrained(rid, subfolder=sub, use_safetensors=True)
        try: pipe.enable_flashvdm()
        except Exception: pass
        n = sum(p.numel() for p in pipe.model.parameters())
        print("OK %s/%s params=%.2fB load=%.0fs" % (rid, sub, n/1e9, time.time()-t))
        sys.exit(0)
    except Exception as e:
        print("FAIL %s/%s -> %s" % (rid, sub, str(e)[:200]))
