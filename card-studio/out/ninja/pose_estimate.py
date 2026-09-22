"""Estimate the character's pose from the image (MediaPipe Tasks PoseLandmarker,
free/local, isolated venv). Writes pose.json (2D image landmarks + 3D world landmarks)
so the assembler can pose the skeleton to the image, bind the parts, then reset to
T-pose. Real-human model -> may miss a stylized character; the caller falls back to a
SAM-centroid limb estimate on NO_POSE_DETECTED."""
import mediapipe as mp, cv2, json, os, sys
from mediapipe.tasks import python
from mediapipe.tasks.python import vision
BASE = r"C:\Users\vaugh\discord\card-studio\out\ninja"
MODEL = r"C:\Users\vaugh\discord\card-studio\ml\mp_venv\pose_landmarker_heavy.task"
img = cv2.imread(os.path.join(BASE, "source.png"))
H, W = img.shape[:2]
opts = vision.PoseLandmarkerOptions(
    base_options=python.BaseOptions(model_asset_path=MODEL),
    num_poses=1, min_pose_detection_confidence=0.25, min_pose_presence_confidence=0.25)
with vision.PoseLandmarker.create_from_options(opts) as lm:
    rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    res = lm.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))
if not res.pose_landmarks:
    print("NO_POSE_DETECTED"); sys.exit(2)
pl = res.pose_landmarks[0]
wl = res.pose_world_landmarks[0] if res.pose_world_landmarks else []
lm2d = [{"x": p.x, "y": p.y, "z": p.z, "v": p.visibility} for p in pl]
world = [{"x": p.x, "y": p.y, "z": p.z} for p in wl]
json.dump({"image": [W, H], "landmarks": lm2d, "world": world}, open(os.path.join(BASE, "pose.json"), "w"))
# viz: draw joints + bones on the source
NAMES = {11: "L_sho", 12: "R_sho", 13: "L_elb", 14: "R_elb", 15: "L_wri", 16: "R_wri",
         23: "L_hip", 24: "R_hip", 25: "L_kne", 26: "R_kne", 27: "L_ank", 28: "R_ank", 0: "nose"}
BONES = [(11, 13), (13, 15), (12, 14), (14, 16), (11, 12), (23, 24), (11, 23), (12, 24),
         (23, 25), (25, 27), (24, 26), (26, 28)]
viz = img.copy()
for a, b in BONES:
    cv2.line(viz, (int(pl[a].x * W), int(pl[a].y * H)), (int(pl[b].x * W), int(pl[b].y * H)), (0, 255, 0), 3)
for i, nm in NAMES.items():
    p = pl[i]; cv2.circle(viz, (int(p.x * W), int(p.y * H)), 5, (0, 0, 255), -1)
cv2.imwrite(os.path.join(BASE, "pose_viz.png"), viz)
for i, nm in NAMES.items():
    p = pl[i]; print(nm, "px", round(p.x * W), round(p.y * H), "vis", round(p.visibility, 2))
print("POSE_OK")
