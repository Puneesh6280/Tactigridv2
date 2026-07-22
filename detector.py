#!/usr/bin/env python3
"""
Scene object detection for one Pano2VR panorama node.

The panorama is stored as six cube faces, each an undistorted 90 deg view, so a
standard detector runs cleanly on them with none of the warping a raw
equirectangular image would have. Each face maps to a direction relative to the
viewer, so results say not just WHAT is around you but roughly WHICH WAY.

Runs YOLOv8 through OpenCV's DNN module - CPU only, no torch/ultralytics.

Usage:  python detector.py <node_tiles_dir> <model.onnx>
Output: JSON on stdout (see build_result).
"""
import sys, os, json, glob
import numpy as np
import cv2

COCO = ["person","bicycle","car","motorcycle","airplane","bus","train","truck","boat","traffic light","fire hydrant","stop sign","parking meter","bench","bird","cat","dog","horse","sheep","cow","elephant","bear","zebra","giraffe","backpack","umbrella","handbag","tie","suitcase","frisbee","skis","snowboard","sports ball","kite","baseball bat","baseball glove","skateboard","surfboard","tennis racket","bottle","wine glass","cup","fork","knife","spoon","bowl","banana","apple","sandwich","orange","broccoli","carrot","hot dog","pizza","donut","cake","chair","couch","potted plant","bed","dining table","toilet","tv","laptop","mouse","remote","keyboard","cell phone","microwave","oven","toaster","sink","refrigerator","book","clock","vase","scissors","teddy bear","hair drier","toothbrush"]

# Pano2VR cube face order. Up/down are ceiling/floor; the four side faces are
# the horizontal ring. The exact side->compass mapping depends on the tour's
# pannorth, so these are described as relative directions the UI can relabel.
FACE_DIRECTION = {
    "cf_0": "front",
    "cf_1": "right",
    "cf_2": "back",
    "cf_3": "left",
    "cf_4": "up",
    "cf_5": "down",
}

def stitch_face(node_dir, cf, level):
    files = glob.glob(os.path.join(node_dir, cf, level, "c_*", "tile_*.jpg"))
    if not files:
        return None
    grid, maxc, maxr = {}, 0, 0
    for f in files:
        col = int(os.path.basename(os.path.dirname(f)).split("_")[1])
        row = int(os.path.basename(f).split("_")[1].split(".")[0])
        grid[(col, row)] = f
        maxc, maxr = max(maxc, col), max(maxr, row)
    rows = []
    for r in range(maxr + 1):
        cols = [cv2.imread(grid[(c, r)]) for c in range(maxc + 1) if (c, r) in grid]
        if cols:
            rows.append(cv2.hconcat(cols))
    return cv2.vconcat(rows) if rows else None

def pick_level(node_dir, cf, preferred=("l_2", "l_1", "l_0")):
    for lvl in preferred:
        if glob.glob(os.path.join(node_dir, cf, lvl, "c_*", "tile_*.jpg")):
            return lvl
    return None

def detect(net, img, conf_th=0.35, iou_th=0.45):
    h, w = img.shape[:2]
    blob = cv2.dnn.blobFromImage(img, 1 / 255.0, (640, 640), swapRB=True, crop=False)
    net.setInput(blob)
    out = np.squeeze(net.forward()).T  # (8400, 84) for YOLOv8
    boxes, scores, ids = [], [], []
    x_f, y_f = w / 640, h / 640
    for row in out:
        cls = row[4:]
        cid = int(np.argmax(cls))
        sc = float(cls[cid])
        if sc < conf_th:
            continue
        cx, cy, bw, bh = row[:4]
        boxes.append([int((cx - bw / 2) * x_f), int((cy - bh / 2) * y_f), int(bw * x_f), int(bh * y_f)])
        scores.append(sc)
        ids.append(cid)
    keep = cv2.dnn.NMSBoxes(boxes, scores, conf_th, iou_th)
    dets = []
    for i in (np.array(keep).flatten() if len(keep) else []):
        x, y, bw, bh = boxes[i]
        dets.append({
            "label": COCO[ids[i]],
            "confidence": round(float(scores[i]), 3),
            # Fraction of the face, so the UI can place a marker regardless of
            # the stitched resolution.
            "box": [round(x / w, 4), round(y / h, 4), round(bw / w, 4), round(bh / h, 4)]
        })
    return dets

def build_result(node_dir, model_path, conf_th=0.35):
    net = cv2.dnn.readNetFromONNX(model_path)
    faces = []
    totals = {}
    for cf, direction in FACE_DIRECTION.items():
        lvl = pick_level(node_dir, cf)
        if not lvl:
            continue
        img = stitch_face(node_dir, cf, lvl)
        if img is None:
            continue
        dets = detect(net, img, conf_th)
        for d in dets:
            totals[d["label"]] = totals.get(d["label"], 0) + 1
        faces.append({"face": cf, "direction": direction, "detections": dets})

    summary = [{"label": k, "count": v} for k, v in sorted(totals.items(), key=lambda kv: -kv[1])]
    return {
        "ok": True,
        "objectCount": sum(totals.values()),
        "summary": summary,
        "faces": faces,
        "classesModel": "COCO-80 (general objects; doors/windows not in this model)"
    }

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"ok": False, "error": "usage: detector.py <node_tiles_dir> <model.onnx>"}))
        sys.exit(1)
    node_dir, model_path = sys.argv[1], sys.argv[2]
    try:
        if not os.path.isdir(node_dir):
            raise FileNotFoundError(f"node tiles dir not found: {node_dir}")
        if not os.path.isfile(model_path):
            raise FileNotFoundError(f"model not found: {model_path}")
        print(json.dumps(build_result(node_dir, model_path)))
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        sys.exit(1)
