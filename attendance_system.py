import cv2
import os
import numpy as np
from datetime import datetime
import json
import tkinter as tk
from tkinter import messagebox, ttk, simpledialog
from PIL import Image, ImageTk
from dotenv import load_dotenv
from supabase import create_client

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
        self.students = {}

        # Supabase setup
        load_dotenv()
        self.supabase = self._init_supabase_client()
        self.students_table = os.getenv("SUPABASE_STUDENTS_TABLE", "students")
        self.attendance_table = os.getenv("SUPABASE_ATTENDANCE_TABLE", "attendance")
        self.photos_table = os.getenv("SUPABASE_STUDENT_PHOTOS_TABLE", "student_photos")
        self.photos_bucket = os.getenv("SUPABASE_PHOTOS_BUCKET", "student-photos")

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
    def _init_supabase_client(self):
        supabase_url = os.getenv("SUPABASE_URL")
        supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY")

        if not supabase_url or not supabase_key:
            messagebox.showerror(
                "Supabase Config Missing",
                "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_KEY) in .env"
            )
            self.window.quit()
            return None

        try:
            return create_client(supabase_url, supabase_key)
        except Exception as e:
            messagebox.showerror("Supabase Error", f"Could not create Supabase client:\n{e}")
            self.window.quit()
            return None

    def load_students_db(self):
        try:
            response = self.supabase.table(self.students_table).select("*").execute()
            students = {}

            for row in response.data or []:
                reg = str(row["reg_number"])
                students[reg] = {
                    "id": int(row["student_id"]),
                    "name": row["name"],
                    "reg_number": reg,
                    "photo_dir": row.get("photo_dir", ""),
                    "registered_date": row.get("registered_date", ""),
                    "model_trained": bool(row.get("model_trained", False)),
                    "model_trained_at": row.get("model_trained_at")
                }
            return students
        except Exception as e:
            messagebox.showerror("Supabase Error", f"Failed to load students from database:\n{e}")
            return {}

    def save_students_db(self):
        # Kept for backward compatibility with existing flow.
        # Data persistence is handled in Supabase now.
        pass

    def get_next_student_id(self):
        if not self.students:
            return 1
        return max(student["id"] for student in self.students.values()) + 1

    def save_student_to_supabase(self, student_data):
        try:
            self.supabase.table(self.students_table).upsert(
                student_data,
                on_conflict="reg_number"
            ).execute()
            return True
        except Exception as e:
            messagebox.showerror("Supabase Error", f"Failed to save student:\n{e}")
            return False

    def save_attendance_to_supabase(self, attendance_data):
        try:
            self.supabase.table(self.attendance_table).upsert(
                attendance_data,
                on_conflict="attendance_date,reg_number"
            ).execute()
            return True
        except Exception as e:
            messagebox.showerror("Supabase Error", f"Failed to mark attendance in database:\n{e}")
            return False

    def get_training_status_from_db(self):
        try:
            response = self.supabase.table(self.students_table).select("reg_number,model_trained").execute()
            rows = response.data or []

            if not rows:
                return {"all_trained": False, "untrained_regs": []}

            untrained_regs = [str(row["reg_number"]) for row in rows if not bool(row.get("model_trained", False))]
            return {"all_trained": len(untrained_regs) == 0, "untrained_regs": untrained_regs}
        except Exception as e:
            messagebox.showerror("Supabase Error", f"Failed to check training status from DB:\n{e}")
            return None

    def mark_students_trained_in_db(self, reg_numbers):
        if not reg_numbers:
            return True

        now_iso = datetime.now().isoformat()
        try:
            for reg_number in reg_numbers:
                self.supabase.table(self.students_table).update(
                    {"model_trained": True, "model_trained_at": now_iso}
                ).eq("reg_number", reg_number).execute()
            return True
        except Exception as e:
            messagebox.showerror("Supabase Error", f"Failed to update training status:\n{e}")
            return False

    def save_student_photo_to_supabase(self, photo_data):
        try:
            self.supabase.table(self.photos_table).insert(photo_data).execute()
            return True
        except Exception as e:
            messagebox.showerror("Supabase Error", f"Failed to save student photo metadata:\n{e}")
            return False

    def _sanitize_for_path(self, value):
        cleaned = []
        for ch in value.strip():
            if ch.isalnum() or ch in ("-", "_"):
                cleaned.append(ch)
            else:
                cleaned.append("_")
        return "".join(cleaned) or "student"

    def upload_student_photo(self, reg_number, student_name, photo_no, local_photo_path):
        safe_student = self._sanitize_for_path(f"{reg_number}_{student_name}")
        timestamp = datetime.now().strftime("%Y%m%d%H%M%S%f")
        storage_path = f"{safe_student}/photo_{photo_no}_{timestamp}.jpg"

        try:
            with open(local_photo_path, "rb") as img_file:
                self.supabase.storage.from_(self.photos_bucket).upload(
                    path=storage_path,
                    file=img_file.read(),
                    file_options={"content-type": "image/jpeg", "upsert": "true"}
                )

            public_url = self.supabase.storage.from_(self.photos_bucket).get_public_url(storage_path)
            return {
                "storage_path": storage_path,
                "public_url": public_url
            }
        except Exception as e:
            messagebox.showerror("Supabase Error", f"Failed to upload student photo:\n{e}")
            return None

    # --- Core Functionality ---
    def register_student(self):
        name = simpledialog.askstring("Input", "Enter Student Name:")
        if not name: return
        reg_number = simpledialog.askstring("Input", "Enter Registration Number:")
        if not reg_number: return

        if reg_number in self.students:
            messagebox.showerror("Error", f"Reg Number {reg_number} already exists!")
            return

        student_id = self.get_next_student_id()
        student_photo_dir = os.path.join(self.students_dir, f"{reg_number}_{name}")
        os.makedirs(student_photo_dir, exist_ok=True)

        messagebox.showinfo("Instructions", "Camera will open. Press SPACE to capture 10 photos. Look at the camera.")

        cap = cv2.VideoCapture(0)
        photo_count = 0
        captured_photo_paths = []
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
                captured_photo_paths.append(photo_path)
                photo_count += 1
            elif key == 27: # Esc
                break

        cap.release()
        cv2.destroyAllWindows()

        if photo_count == 10:
            uploaded_photos = []
            for idx, local_photo_path in enumerate(captured_photo_paths, start=1):
                upload_result = self.upload_student_photo(reg_number, name, idx, local_photo_path)
                if upload_result:
                    uploaded_photos.append({
                        "photo_no": idx,
                        "storage_path": upload_result["storage_path"],
                        "public_url": upload_result["public_url"]
                    })

            profile_photo_path = uploaded_photos[0]["storage_path"] if uploaded_photos else None
            profile_photo_url = uploaded_photos[0]["public_url"] if uploaded_photos else None

            student_data = {
                "id": student_id, "name": name, "reg_number": reg_number,
                "photo_dir": student_photo_dir, "registered_date": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            }
            supabase_student_data = {
                "student_id": student_id,
                "name": name,
                "reg_number": reg_number,
                "photo_dir": student_photo_dir,
                "registered_date": datetime.now().isoformat(),
                "profile_photo_path": profile_photo_path,
                "profile_photo_url": profile_photo_url,
                "model_trained": False,
                "model_trained_at": None
            }

            if self.save_student_to_supabase(supabase_student_data):
                for photo in uploaded_photos:
                    self.save_student_photo_to_supabase({
                        "reg_number": reg_number,
                        "student_name": name,
                        "photo_no": photo["photo_no"],
                        "storage_path": photo["storage_path"],
                        "photo_url": photo["public_url"],
                        "captured_at": datetime.now().isoformat()
                    })
                self.students[reg_number] = student_data
                messagebox.showinfo(
                    "Success",
                    f"Student {name} registered!\nUploaded {len(uploaded_photos)}/10 photos to Supabase Storage."
                )
                self.status_var.set(f"Registered {name}")
            else:
                messagebox.showerror("Error", "Student registered locally, but DB save failed.")

    def train_model(self):
        if not self.students:
            messagebox.showwarning("Warning", "No students registered to train!")
            return

        training_status = self.get_training_status_from_db()
        if training_status is None:
            return

        if training_status["all_trained"]:
            messagebox.showerror("Error", "Model has already been trained for all registered students.")
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

            if not self.mark_students_trained_in_db(training_status["untrained_regs"]):
                return

            for reg in training_status["untrained_regs"]:
                if reg in self.students:
                    self.students[reg]["model_trained"] = True
                    self.students[reg]["model_trained_at"] = datetime.now().isoformat()

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
        window_name = 'Mark Attendance - Press ESC to exit'
        
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
                            current_time = datetime.now().strftime("%H:%M:%S")
                            attendance_record[reg] = {
                                "name": name, "reg_number": reg,
                                "time": current_time, "status": "Present"
                            }
                            with open(attendance_file, 'w') as f:
                                json.dump(attendance_record, f, indent=4)

                            attendance_data = {
                                "attendance_date": today,
                                "reg_number": reg,
                                "name": name,
                                "time": current_time,
                                "status": "Present",
                                "marked_at": datetime.now().isoformat()
                            }
                            self.save_attendance_to_supabase(attendance_data)
                        
                        cv2.rectangle(frame, (x, y), (x+w, y+h), (0, 255, 0), 2)
                        cv2.putText(frame, f"{name} (Marked)", (x, y-10), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)
                else:
                    cv2.rectangle(frame, (x, y), (x+w, y+h), (0, 0, 255), 2)
                    cv2.putText(frame, "Unknown", (x, y-10), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2)

            cv2.imshow(window_name, frame)
            key = cv2.waitKey(1) & 0xFF
            if key == 27:
                break

            # If user closes the OpenCV window via the X button, stop the loop.
            if cv2.getWindowProperty(window_name, cv2.WND_PROP_VISIBLE) < 1:
                break

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
