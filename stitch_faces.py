#!/usr/bin/env python3
"""
Stitch a Pano2VR node's six cube faces into single images.

Two modes:
  python stitch_faces.py <node_dir> save <out_dir>     -> writes <direction>.jpg files
  python stitch_faces.py <node_dir> base64 [max_px]    -> JSON {faces:[{direction,face,b64}]}

Faces are downscaled to max_px (default 1024) so the base64 payload stays
reasonable for a vision API call.
"""
import sys, os, json, glob, base64
import cv2

FACE_DIRECTION = {
    "cf_0": "front", "cf_1": "right", "cf_2": "back",
    "cf_3": "left", "cf_4": "up", "cf_5": "down",
}

def pick_level(node_dir, cf, preferred=("l_2", "l_1", "l_0")):
    for lvl in preferred:
        if glob.glob(os.path.join(node_dir, cf, lvl, "c_*", "tile_*.jpg")):
            return lvl
    return None

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

def resize_max(img, max_px):
    h, w = img.shape[:2]
    scale = min(1.0, max_px / max(h, w))
    if scale < 1.0:
        img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    return img

def each_face(node_dir, max_px):
    for cf, direction in FACE_DIRECTION.items():
        lvl = pick_level(node_dir, cf)
        if not lvl:
            continue
        img = stitch_face(node_dir, cf, lvl)
        if img is None:
            continue
        yield cf, direction, resize_max(img, max_px)

if __name__ == "__main__":
    node_dir = sys.argv[1]
    mode = sys.argv[2] if len(sys.argv) > 2 else "base64"

    if mode == "save":
        out_dir = sys.argv[3]
        os.makedirs(out_dir, exist_ok=True)
        for cf, direction, img in each_face(node_dir, 1024):
            cv2.imwrite(os.path.join(out_dir, f"{direction}.jpg"), img)
        print(json.dumps({"ok": True, "out": out_dir}))
    else:
        max_px = int(sys.argv[3]) if len(sys.argv) > 3 else 1024
        faces = []
        for cf, direction, img in each_face(node_dir, max_px):
            ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 85])
            if ok:
                faces.append({"face": cf, "direction": direction, "b64": base64.b64encode(buf).decode("ascii")})
        print(json.dumps({"ok": True, "faces": faces}))
