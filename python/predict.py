import argparse
import json
from pathlib import Path

import cv2
from ultralytics import YOLO


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="YOLOv8 inference runner")
    parser.add_argument("--model", required=True, help="Path ke file model .pt")
    parser.add_argument("--source", required=True, help="Path ke file gambar input")
    parser.add_argument("--output", required=True, help="Path output gambar teranotasi")
    parser.add_argument("--conf", type=float, default=0.25, help="Confidence threshold")
    parser.add_argument("--imgsz", type=int, default=768, help="Ukuran image inferensi")
    parser.add_argument("--iou", type=float, default=0.7, help="IoU threshold NMS")
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    model = YOLO(args.model)
    results = model.predict(
        source=args.source,
        conf=args.conf,
        iou=args.iou,
        imgsz=args.imgsz,
        save=False,
        verbose=False,
    )
    result = results[0]

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    plotted = result.plot()
    cv2.imwrite(str(output_path), plotted)

    names = result.names
    detections = []
    class_counts = {}

    if result.boxes is not None:
        boxes_xyxy = result.boxes.xyxy.cpu().tolist()
        boxes_conf = result.boxes.conf.cpu().tolist()
        boxes_cls = result.boxes.cls.cpu().tolist()

        for xyxy, conf, cls_id in zip(boxes_xyxy, boxes_conf, boxes_cls):
            class_name = names.get(int(cls_id), str(int(cls_id)))
            class_counts[class_name] = class_counts.get(class_name, 0) + 1
            detections.append(
                {
                    "className": class_name,
                    "confidence": float(conf),
                    "box": {
                        "x1": float(xyxy[0]),
                        "y1": float(xyxy[1]),
                        "x2": float(xyxy[2]),
                        "y2": float(xyxy[3]),
                    },
                }
            )

    payload = {
        "detections": detections,
        "imageWidth": int(result.orig_shape[1]),
        "imageHeight": int(result.orig_shape[0]),
        "modelNames": {str(k): v for k, v in names.items()},
        "classCounts": class_counts,
    }

    print(json.dumps(payload))


if __name__ == "__main__":
    main()
