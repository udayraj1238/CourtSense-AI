import os
from ultralytics import YOLO

def main():
    # Load the base YOLOv8 nano model
    model = YOLO("yolov8n.pt")
    
    data_yaml = os.path.abspath("backend/training/datasets/tennis_ball/data.yaml")
    print(f"Starting training with config: {data_yaml}")
    
    # Fine-tune the model
    # We do 5 epochs for speed, just enough to learn the synthetic blob
    results = model.train(
        data=data_yaml,
        epochs=5,
        imgsz=640,
        batch=16,
        device="cpu", # Force CPU just in case
        project="backend/training/runs",
        name="tennis_ball_finetune"
    )
    
    # Evaluate model performance on the validation set
    metrics = model.val()
    
    # Save the new model to the project root
    new_weights_path = "backend/training/runs/tennis_ball_finetune/weights/best.pt"
    if os.path.exists(new_weights_path):
        import shutil
        shutil.copy(new_weights_path, "yolov8n_tennis.pt")
        print("Training complete! New weights saved as yolov8n_tennis.pt")
    else:
        print("Training failed or weights not found.")

if __name__ == "__main__":
    main()
