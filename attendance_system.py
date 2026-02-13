import cv2
import os
import numpy as np
from datetime import datetime
import json
import tkinter as tk
from tkinter import messagebox, ttk, simpledialog
from PIL import Image, ImageTk

class AttendanceSystemGUI:
    def __init__(self, window):
        self.window = window
        self.window.title("Face Recognition Attendance System")
        self.window.geometry("800x600")
        
        # Directories Setup
        self.base_dir = "attendance_data"
        self.students_dir = os.path.join(self.base_dir, "students")
        self.models_dir = os.path.join(self.base_dir, "models")
        self.attendance_dir = os.path.join(self.base_dir, "attendance")
        
        os.makedirs(self.students_dir, exist_ok=True)
        os.makedirs(self.models_dir, exist_ok=True)
        os.makedirs(self.attendance_dir, exist_ok=True)
        
        # Logic Components
        self.face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
        self.recognizer = cv2.face.LBPHFaceRecognizer_create()
        self.students_db_path = os.path.join(self.base_dir, "students_db.json")
        self.students = self.load_students_db()
        
        self.model_path = os.path.join(self.models_dir, "face_model.yml")
        if os.path.exists(self.model_path):
            self.recognizer.read(self.model_path)

        self.setup_gui()

    def setup_gui(self):
        # Header
        header = tk.Label(self.window, text="Attendance System", font=("Arial", 24, "bold"), pady=20)
        header.pack()

        # Main Button Container
        btn_frame = tk.Frame(self.window)
        btn_frame.pack(pady=20)

        # Buttons
        style = ttk.Style()
        style.configure('TButton', font=('Arial', 12), padding=10)

        ttk.Button(btn_frame, text="1. Register New Student", width=30, command=self.register_student).grid(row=0, column=0, padx=10, pady=10)
        ttk.Button(btn_frame, text="2. Train Model", width=30, command=self.train_model).grid(row=1, column=0, padx=10, pady=10)
        ttk.Button(btn_frame, text="3. Mark Attendance", width=30, command=self.mark_attendance).grid(row=2, column=0, padx=10, pady=10)
        ttk.Button(btn_frame, text="4. View Registered Students", width=30, command=self.view_students).grid(row=3, column=0, padx=10, pady=10)
        ttk.Button(btn_frame, text="5. View Attendance Records", width=30, command=self.view_attendance_history).grid(row=4, column=0, padx=10, pady=10)
        ttk.Button(btn_frame, text="6. Exit", width=30, command=self.window.quit).grid(row=5, column=0, padx=10, pady=10)

        # Status Bar
        self.status_var = tk.StringVar(value="System Ready")
        status_bar = tk.Label(self.window, textvariable=self.status_var, bd=1, relief=tk.SUNKEN, anchor=tk.W)
        status_bar.pack(side=tk.BOTTOM, fill=tk.X)

    # --- Database Logic ---
    def load_students_db(self):
        if os.path.exists(self.students_db_path):
            with open(self.students_db_path, 'r') as f:
                return json.load(f)
        return {}

    def save_students_db(self):
        with open(self.students_db_path, 'w') as f:
            json.dump(self.students, f, indent=4)

    # --- Core Functionality ---
    def register_student(self):
        name = simpledialog.askstring("Input", "Enter Student Name:")
        if not name: return
        reg_number = simpledialog.askstring("Input", "Enter Registration Number:")
        if not reg_number: return

        if reg_number in self.students:
            messagebox.showerror("Error", f"Reg Number {reg_number} already exists!")
            return

        student_id = len(self.students) + 1
        student_photo_dir = os.path.join(self.students_dir, f"{reg_number}_{name}")
        os.makedirs(student_photo_dir, exist_ok=True)

        messagebox.showinfo("Instructions", "Camera will open. Press SPACE to capture 10 photos. Look at the camera.")

        cap = cv2.VideoCapture(0)
        photo_count = 0
        while photo_count < 10:
            ret, frame = cap.read()
            if not ret: break
            
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            faces = self.face_cascade.detectMultiScale(gray, 1.3, 5)
            
            for (x, y, w, h) in faces:
                cv2.rectangle(frame, (x, y), (x+w, y+h), (0, 255, 0), 2)
            
            cv2.putText(frame, f"Captured: {photo_count}/10", (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2)
            cv2.imshow('Registration - Press SPACE to capture', frame)
            
            key = cv2.waitKey(1)
            if key == 32 and len(faces) > 0: # Space
                photo_path = os.path.join(student_photo_dir, f"photo_{photo_count + 1}.jpg")
                cv2.imwrite(photo_path, frame)
                photo_count += 1
            elif key == 27: # Esc
                break

        cap.release()
        cv2.destroyAllWindows()

        if photo_count == 10:
            self.students[reg_number] = {
                "id": student_id, "name": name, "reg_number": reg_number,
                "photo_dir": student_photo_dir, "registered_date": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            }
            self.save_students_db()
            messagebox.showinfo("Success", f"Student {name} registered!")
            self.status_var.set(f"Registered {name}")

    def train_model(self):
        if not self.students:
            messagebox.showwarning("Warning", "No students registered to train!")
            return

        faces, labels = [], []
        for reg_num, info in self.students.items():
            photo_dir = info['photo_dir']
            for photo_file in os.listdir(photo_dir):
                if photo_file.endswith('.jpg'):
                    img = cv2.imread(os.path.join(photo_dir, photo_file))
                    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
                    detected = self.face_cascade.detectMultiScale(gray, 1.3, 5)
                    for (x, y, w, h) in detected:
                        faces.append(gray[y:y+h, x:x+w])
                        labels.append(info['id'])

        if faces:
            self.recognizer.train(faces, np.array(labels))
            self.recognizer.save(self.model_path)
            messagebox.showinfo("Success", "Model trained successfully!")
            self.status_var.set("Model Trained")
        else:
            messagebox.showerror("Error", "No faces found in photos!")

    def mark_attendance(self):
        if not os.path.exists(self.model_path):
            messagebox.showerror("Error", "Train the model first!")
            return

        today = datetime.now().strftime("%Y-%m-%d")
        attendance_file = os.path.join(self.attendance_dir, f"attendance_{today}.json")
        
        attendance_record = {}
        if os.path.exists(attendance_file):
            with open(attendance_file, 'r') as f: attendance_record = json.load(f)

        cap = cv2.VideoCapture(0)
        while True:
            ret, frame = cap.read()
            if not ret: break
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            faces = self.face_cascade.detectMultiScale(gray, 1.3, 5)

            for (x, y, w, h) in faces:
                label, confidence = self.recognizer.predict(gray[y:y+h, x:x+w])
                
                if confidence < 70:
                    student_info = next((s for s in self.students.values() if s['id'] == label), None)
                    if student_info:
                        name = student_info['name']
                        reg = student_info['reg_number']
                        
                        if reg not in attendance_record:
                            attendance_record[reg] = {
                                "name": name, "reg_number": reg,
                                "time": datetime.now().strftime("%H:%M:%S"), "status": "Present"
                            }
                            with open(attendance_file, 'w') as f: json.dump(attendance_record, f, indent=4)
                        
                        cv2.rectangle(frame, (x, y), (x+w, y+h), (0, 255, 0), 2)
                        cv2.putText(frame, f"{name} (Marked)", (x, y-10), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)
                else:
                    cv2.rectangle(frame, (x, y), (x+w, y+h), (0, 0, 255), 2)
                    cv2.putText(frame, "Unknown", (x, y-10), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2)

            cv2.imshow('Mark Attendance - Press ESC to exit', frame)
            if cv2.waitKey(1) == 27: break

        cap.release()
        cv2.destroyAllWindows()
        self.status_var.set(f"Attendance session ended. {len(attendance_record)} present today.")

    def view_students(self):
        view_win = tk.Toplevel(self.window)
        view_win.title("Registered Students")
        view_win.geometry("400x400")
        
        listbox = tk.Listbox(view_win, font=("Arial", 10))
        listbox.pack(fill=tk.BOTH, expand=True, padx=10, pady=10)
        
        for reg, info in self.students.items():
            listbox.insert(tk.END, f"{info['name']} (ID: {reg})")

    def view_attendance_history(self):
        files = [f for f in os.listdir(self.attendance_dir) if f.endswith('.json')]
        if not files:
            messagebox.showinfo("Info", "No records found.")
            return
        
        history_win = tk.Toplevel(self.window)
        history_win.title("Attendance Records")
        
        lbl = tk.Label(history_win, text="Select Date:", pady=10)
        lbl.pack()
        
        combo = ttk.Combobox(history_win, values=files)
        combo.pack(padx=20, pady=10)
        
        def show_data():
            file_path = os.path.join(self.attendance_dir, combo.get())
            with open(file_path, 'r') as f:
                data = json.load(f)
                report = "\n".join([f"{v['name']} - {v['time']}" for v in data.values()])
                messagebox.showinfo("Attendance Report", report if report else "Empty")

        ttk.Button(history_win, text="View Report", command=show_data).pack(pady=10)

if __name__ == "__main__":
    root = tk.Tk()
    app = AttendanceSystemGUI(root)
    root.mainloop()