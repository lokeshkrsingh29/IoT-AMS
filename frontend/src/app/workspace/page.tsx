"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type Student = {
  student_id: number;
  name: string;
  reg_number: string;
  telegram_id: string;
  registered_date: string;
  model_trained: boolean;
  model_trained_at: string | null;
  profile_photo_url: string | null;
};

type Attendance = {
  attendance_date: string;
  reg_number: string;
  name: string;
  time: string;
  status: string;
};

type RecognitionDatasetRow = {
  reg_number: string;
  name: string;
  photo_urls: string[];
};

type ScheduledClass = {
  id: number;
  teacher_name: string;
  teacher_unique_id: string;
  class_name: string;
  duration_minutes: number;
  class_time: string;
  class_start_at: string;
  class_end_at: string;
};

type ProcessStep = {
  key: string;
  label: string;
  status: "pending" | "active" | "done" | "error";
  detail?: string;
};

type FaceApiModule = typeof import("@vladmandic/face-api");

export default function Home() {
  const registrationVideoRef = useRef<HTMLVideoElement | null>(null);
  const registrationCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const recognitionVideoRef = useRef<HTMLVideoElement | null>(null);
  const recognitionCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const registrationStreamRef = useRef<MediaStream | null>(null);
  const recognitionStreamRef = useRef<MediaStream | null>(null);
  const registrationLoopRef = useRef<number | null>(null);
  const recognitionLoopRef = useRef<number | null>(null);
  const markingLockRef = useRef(false);
  const markedRegsRef = useRef<Set<string>>(new Set());
  const sessionStartRef = useRef<number | null>(null);
  const totalClassMsRef = useRef(0);
  const requiredPresenceMsRef = useRef(0);
  const presenceMsRef = useRef<Map<string, number>>(new Map());
  const faceApiRef = useRef<FaceApiModule | null>(null);
  const matcherRef = useRef<InstanceType<FaceApiModule["FaceMatcher"]> | null>(null);
  const classStartTimeoutsRef = useRef<Map<number, number>>(new Map());
  const classStopTimeoutsRef = useRef<Map<number, number>>(new Map());
  const scheduledClassIdsRef = useRef<Set<number>>(new Set());
  const currentClassIdRef = useRef<number | null>(null);
  const finalizedClassIdsRef = useRef<Set<number>>(new Set());

  const [name, setName] = useState("");
  const [regNumber, setRegNumber] = useState("");
  const [telegramId, setTelegramId] = useState("");
  const [photos, setPhotos] = useState<Blob[]>([]);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [recognitionRunning, setRecognitionRunning] = useState(false);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [classDurationMinutes, setClassDurationMinutes] = useState(12);
  const [requiredPresenceMinutes, setRequiredPresenceMinutes] = useState(7);
  const [elapsedMinutes, setElapsedMinutes] = useState(0);
  const [showCreateClassForm, setShowCreateClassForm] = useState(false);
  const [creatingClass, setCreatingClass] = useState(false);
  const [teacherName, setTeacherName] = useState("");
  const [teacherUniqueId, setTeacherUniqueId] = useState("");
  const [classNameInput, setClassNameInput] = useState("");
  const [classDurationInput, setClassDurationInput] = useState(60);
  const [classTimeInput, setClassTimeInput] = useState("");
  const [classProcessSteps, setClassProcessSteps] = useState<ProcessStep[]>([]);
  const [registrationPopup, setRegistrationPopup] = useState<{
    name: string;
    regNumber: string;
    trainedAt: string;
  } | null>(null);
  const [cameraAutomationStatus, setCameraAutomationStatus] = useState<{
    startAt: string;
    endAt: string;
    status: string;
  } | null>(null);

  const [students, setStudents] = useState<Student[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [classes, setClasses] = useState<ScheduledClass[]>([]);
  const [clockNowMs, setClockNowMs] = useState(Date.now());

  const canCapture = useMemo(() => photos.length < 10, [photos.length]);

  async function loadStudents() {
    const res = await fetch("/api/students");
    const json = await res.json();
    if (res.ok) setStudents(json.students || []);
  }

  async function loadAttendance() {
    const res = await fetch("/api/attendance");
    const json = await res.json();
    if (res.ok) setAttendance(json.attendance || []);
  }

  async function loadClasses() {
    const res = await fetch("/api/classes?upcoming=1");
    const json = await res.json();
    if (res.ok) setClasses((json.classes || []) as ScheduledClass[]);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadStudents();
      void loadAttendance();
      void loadClasses();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setClockNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!registrationPopup) return;
    const timer = window.setTimeout(() => setRegistrationPopup(null), 4500);
    return () => window.clearTimeout(timer);
  }, [registrationPopup]);

  useEffect(() => {
    const startTimers = classStartTimeoutsRef.current;
    const stopTimers = classStopTimeoutsRef.current;
    return () => {
      stopRegistrationCamera();
      stopAttendanceCamera();
      for (const timeoutId of startTimers.values()) {
        window.clearTimeout(timeoutId);
      }
      for (const timeoutId of stopTimers.values()) {
        window.clearTimeout(timeoutId);
      }
      startTimers.clear();
      stopTimers.clear();
    };
  }, []);

  function formatDateTime(date: Date) {
    return date.toLocaleString();
  }

  function formatCountdown(ms: number) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  const nextClass = useMemo(() => {
    const now = clockNowMs;
    const upcoming = classes
      .filter((item) => new Date(item.class_start_at).getTime() > now)
      .sort((a, b) => new Date(a.class_start_at).getTime() - new Date(b.class_start_at).getTime());
    return upcoming[0] ?? null;
  }, [classes, clockNowMs]);

  function buildInitialClassProcess(start: Date, end: Date): ProcessStep[] {
    return [
      {
        key: "window",
        label: "Class window calculated",
        status: "done",
        detail: `Start ${formatDateTime(start)}, End ${formatDateTime(end)}`,
      },
      { key: "db", label: "Saving class to database", status: "active" },
      { key: "telegram", label: "Configuring Telegram notifications", status: "pending" },
      { key: "camera", label: "Scheduling camera auto start/stop", status: "pending" },
    ];
  }

  function updateProcessStep(key: string, status: ProcessStep["status"], detail?: string) {
    setClassProcessSteps((prev) =>
      prev.map((step) => (step.key === key ? { ...step, status, detail: detail ?? step.detail } : step))
    );
  }

  function computeClassWindow(classTime: string, durationMinutes: number) {
    const [hoursStr, minutesStr] = classTime.split(":");
    const hours = Number(hoursStr);
    const minutes = Number(minutesStr);
    if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
      throw new Error("Invalid class time.");
    }

    const now = new Date();
    const start = new Date(now);
    start.setHours(hours, minutes, 0, 0);
    if (start.getTime() <= now.getTime()) {
      start.setDate(start.getDate() + 1);
    }

    const end = new Date(start.getTime() + durationMinutes * 60_000);
    return { start, end };
  }

  async function finalizeClassIfNeeded(classId: number | null) {
    if (!classId) return;
    if (finalizedClassIdsRef.current.has(classId)) return;
    finalizedClassIdsRef.current.add(classId);
    setCameraAutomationStatus((prev) => (prev ? { ...prev, status: "Finalizing notifications" } : prev));

    try {
      const res = await fetch("/api/classes/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classId }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMessage(json.error || "Class finalization failed.");
        setCameraAutomationStatus((prev) => (prev ? { ...prev, status: "Finalization failed" } : prev));
        return;
      }

      const sent = Number(json.notification?.sent ?? 0);
      const total = Number(json.notification?.total ?? 0);
      setMessage(`Class ended. Final attendance notifications sent to ${sent}/${total} students.`);
      setCameraAutomationStatus((prev) => (prev ? { ...prev, status: "Completed with notifications" } : prev));
    } catch {
      setMessage("Class ended, but could not send final notifications.");
      setCameraAutomationStatus((prev) => (prev ? { ...prev, status: "Finalization failed" } : prev));
    }
  }

  function scheduleCameraAutomation(startAt: Date, endAt: Date, durationMinutes: number, classId: number) {
    const existingStart = classStartTimeoutsRef.current.get(classId);
    if (existingStart) {
      window.clearTimeout(existingStart);
      classStartTimeoutsRef.current.delete(classId);
    }
    const existingStop = classStopTimeoutsRef.current.get(classId);
    if (existingStop) {
      window.clearTimeout(existingStop);
      classStopTimeoutsRef.current.delete(classId);
    }

    const now = Date.now();
    const msToStart = startAt.getTime() - now;
    const msToEnd = endAt.getTime() - now;
    setClassDurationMinutes(durationMinutes);

    setCameraAutomationStatus({
      startAt: formatDateTime(startAt),
      endAt: formatDateTime(endAt),
      status: "Scheduled",
    });

    if (msToStart <= 0 && msToEnd > 0) {
      void startAttendanceCamera(durationMinutes, classId);
      setCameraAutomationStatus({
        startAt: formatDateTime(startAt),
        endAt: formatDateTime(endAt),
        status: "Running",
      });
    } else if (msToStart > 0) {
      const startTimeout = window.setTimeout(() => {
        void startAttendanceCamera(durationMinutes, classId);
        setCameraAutomationStatus({
          startAt: formatDateTime(startAt),
          endAt: formatDateTime(endAt),
          status: "Running",
        });
        classStartTimeoutsRef.current.delete(classId);
      }, msToStart);
      classStartTimeoutsRef.current.set(classId, startTimeout);
    }

    if (msToEnd > 0) {
      const stopTimeout = window.setTimeout(async () => {
        stopAttendanceCamera();
        await finalizeClassIfNeeded(classId);
        setCameraAutomationStatus((prev) => ({
          startAt: formatDateTime(startAt),
          endAt: formatDateTime(endAt),
          status: prev?.status === "Completed with notifications" ? prev.status : "Completed",
        }));
        classStopTimeoutsRef.current.delete(classId);
      }, msToEnd);
      classStopTimeoutsRef.current.set(classId, stopTimeout);
    }

    scheduledClassIdsRef.current.add(classId);
  }

  function scheduleClassFromRow(item: ScheduledClass) {
    const classId = Number(item.id);
    if (!Number.isInteger(classId) || classId <= 0) return;
    if (scheduledClassIdsRef.current.has(classId)) return;

    const startAt = new Date(item.class_start_at);
    const endAt = new Date(item.class_end_at);
    const duration = Number(item.duration_minutes);
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) return;
    if (!Number.isFinite(duration) || duration <= 0) return;
    if (endAt.getTime() <= Date.now()) return;

    scheduleCameraAutomation(startAt, endAt, Math.floor(duration), classId);
  }

  function drawBoxes(
    canvas: HTMLCanvasElement,
    boxes: Array<{ x: number; y: number; width: number; height: number; label?: string; color: string }>,
    overlayLines?: string[]
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (overlayLines && overlayLines.length > 0) {
      const lineHeight = 22;
      const boxHeight = lineHeight * overlayLines.length + 12;
      ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
      ctx.fillRect(12, 12, 330, boxHeight);
      ctx.font = "15px var(--font-space-grotesk)";
      ctx.fillStyle = "#dbeafe";
      overlayLines.forEach((line, idx) => {
        ctx.fillText(line, 20, 33 + idx * lineHeight);
      });
    }

    for (const box of boxes) {
      ctx.strokeStyle = box.color;
      ctx.lineWidth = 3;
      ctx.strokeRect(box.x, box.y, box.width, box.height);
      if (box.label) {
        ctx.fillStyle = box.color;
        ctx.font = "14px var(--font-space-grotesk)";
        ctx.fillText(box.label, box.x, Math.max(16, box.y - 8));
      }
    }
  }

  async function ensureFaceApi() {
    if (faceApiRef.current) return faceApiRef.current;
    const faceApiModule = await import("@vladmandic/face-api");
    faceApiRef.current = faceApiModule;
    return faceApiModule;
  }

  async function ensureModelsLoaded() {
    if (modelsLoaded) return true;
    try {
      const faceapi = await ensureFaceApi();
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri("/models"),
        faceapi.nets.faceLandmark68Net.loadFromUri("/models"),
        faceapi.nets.faceRecognitionNet.loadFromUri("/models"),
      ]);
      setModelsLoaded(true);
      return true;
    } catch {
      setMessage("Could not load face-recognition models from /models.");
      return false;
    }
  }

  async function startRegistrationCamera() {
    try {
      const loaded = await ensureModelsLoaded();
      if (!loaded) return;
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      registrationStreamRef.current = stream;
      if (registrationVideoRef.current) {
        registrationVideoRef.current.srcObject = stream;
      }

      const faceapi = await ensureFaceApi();
      if (registrationLoopRef.current) {
        window.clearInterval(registrationLoopRef.current);
      }

      registrationLoopRef.current = window.setInterval(async () => {
        const video = registrationVideoRef.current;
        const canvas = registrationCanvasRef.current;
        if (!video || !canvas || video.videoWidth === 0 || video.videoHeight === 0) return;

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        const detections = await faceapi
          .detectAllFaces(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }));

        const boxes = detections.map((detection) => ({
          x: detection.box.x,
          y: detection.box.y,
          width: detection.box.width,
          height: detection.box.height,
          color: "#34d399",
        }));
        drawBoxes(canvas, boxes);
      }, 450);

      setMessage("Camera ready. Capture 10 photos.");
    } catch {
      setMessage("Camera permission denied or unavailable.");
    }
  }

  function stopRegistrationCamera() {
    if (registrationLoopRef.current) {
      window.clearInterval(registrationLoopRef.current);
      registrationLoopRef.current = null;
    }
    if (registrationStreamRef.current) {
      registrationStreamRef.current.getTracks().forEach((t) => t.stop());
      registrationStreamRef.current = null;
    }
    if (registrationVideoRef.current) registrationVideoRef.current.srcObject = null;
    if (registrationCanvasRef.current) {
      const ctx = registrationCanvasRef.current.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, registrationCanvasRef.current.width, registrationCanvasRef.current.height);
    }
  }

  function capturePhoto() {
    if (!registrationVideoRef.current || !canCapture) return;
    const video = registrationVideoRef.current;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      setPhotos((prev) => [...prev, blob]);
      setMessage(`Captured ${Math.min(photos.length + 1, 10)}/10 photos.`);
    }, "image/jpeg", 0.9);
  }

  function resetPhotos() {
    setPhotos([]);
    setMessage("Photo queue reset.");
  }

  async function registerStudent(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (photos.length !== 10) {
      setMessage("Capture exactly 10 photos first.");
      return;
    }

    setSaving(true);
    setMessage("Registering student...");
    const fd = new FormData();
    fd.append("name", name);
    fd.append("regNumber", regNumber);
    fd.append("telegramId", telegramId);
    photos.forEach((blob, i) => fd.append("photos", new File([blob], `photo_${i + 1}.jpg`, { type: "image/jpeg" })));

    const res = await fetch("/api/register", { method: "POST", body: fd });
    const json = await res.json();

    if (!res.ok) {
      setMessage(json.error || "Registration failed.");
      setSaving(false);
      return;
    }

    const studentName = String(json.student?.name || name);
    const studentReg = String(json.student?.reg_number || regNumber);
    const trainedAt = String(json.modelTrainedAt || new Date().toISOString());
    setMessage(
      `Student ${studentName} (${studentReg}) registered successfully. Model trained automatically.`
    );
    setRegistrationPopup({
      name: studentName,
      regNumber: studentReg,
      trainedAt,
    });
    setName("");
    setRegNumber("");
    setTelegramId("");
    setPhotos([]);
    stopRegistrationCamera();
    await loadStudents();
    setSaving(false);
  }

  async function createClass(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCreatingClass(true);
    setMessage("Creating class...");

    if (!Number.isFinite(classDurationInput) || classDurationInput <= 0 || !Number.isInteger(classDurationInput)) {
      setMessage("Duration must be a whole number of minutes.");
      setCreatingClass(false);
      return;
    }
    if (!classTimeInput) {
      setMessage("Please select class time.");
      setCreatingClass(false);
      return;
    }

    let startAt: Date;
    let endAt: Date;
    try {
      const window = computeClassWindow(classTimeInput, classDurationInput);
      startAt = window.start;
      endAt = window.end;
    } catch {
      setMessage("Invalid class time. Use HH:MM from time picker.");
      setCreatingClass(false);
      return;
    }

    setClassProcessSteps(buildInitialClassProcess(startAt, endAt));

    const res = await fetch("/api/classes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        teacherName,
        teacherUniqueId,
        className: classNameInput,
        durationMinutes: classDurationInput,
        classTime: classTimeInput,
        classStartAt: startAt.toISOString(),
        classEndAt: endAt.toISOString(),
      }),
    });

    const json = await res.json();
    if (!res.ok) {
      updateProcessStep("db", "error", json.error || "DB save failed.");
      setMessage(json.error || "Class creation failed.");
      setCreatingClass(false);
      return;
    }

    updateProcessStep("db", "done", "Class record saved.");
    if (json.notificationAction === "sent_now") {
      const sent = Number(json.notificationResult?.sent ?? 0);
      const total = Number(json.notificationResult?.total ?? 0);
      updateProcessStep("telegram", "done", `Telegram sent now to ${sent}/${total} students.`);
    } else if (json.notificationAction === "scheduled") {
      const scheduledFor = json.notificationScheduledFor
        ? formatDateTime(new Date(String(json.notificationScheduledFor)))
        : "30 minutes before class";
      updateProcessStep("telegram", "done", `Telegram scheduled for ${scheduledFor}.`);
    } else {
      updateProcessStep("telegram", "error", "TELEGRAM_BOT_TOKEN missing on server.");
    }

    const classId = Number(json.classId);
    if (!Number.isInteger(classId) || classId <= 0) {
      setMessage("Class created, but class ID was invalid. Automation not scheduled.");
      await loadClasses();
      setCreatingClass(false);
      return;
    }

    scheduleCameraAutomation(startAt, endAt, classDurationInput, classId);
    updateProcessStep(
      "camera",
      "done",
      `Camera will auto start at ${formatDateTime(startAt)} and stop at ${formatDateTime(endAt)}.`
    );

    setMessage("Class created successfully. Automation configured.");
    setTeacherName("");
    setTeacherUniqueId("");
    setClassNameInput("");
    setClassDurationInput(60);
    setClassTimeInput("");
    setShowCreateClassForm(false);
    await loadClasses();
    setCreatingClass(false);
  }

  useEffect(() => {
    for (const item of classes) {
      scheduleClassFromRow(item);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classes]);

  async function trainModel() {
    const res = await fetch("/api/train-model", { method: "POST" });
    const json = await res.json();
    setMessage(res.ok ? json.message : json.error || "Train request failed.");
    await loadStudents();
  }

  async function prepareMatcher() {
    const loaded = await ensureModelsLoaded();
    if (!loaded) return false;

    const datasetRes = await fetch("/api/recognition-dataset");
    const datasetJson = await datasetRes.json();
    if (!datasetRes.ok) {
      setMessage(datasetJson.error || "Could not load recognition dataset.");
      return false;
    }

    const dataset = (datasetJson.dataset || []) as RecognitionDatasetRow[];
    if (!dataset.length) {
      setMessage("No students/photos available for recognition.");
      return false;
    }

    const faceapi = await ensureFaceApi();
    const labeled: InstanceType<FaceApiModule["LabeledFaceDescriptors"]>[] = [];

    for (const person of dataset) {
      const descriptors: Float32Array[] = [];

      for (const url of person.photo_urls) {
        try {
          const img = await faceapi.fetchImage(url);
          const result = await faceapi
            .detectSingleFace(img, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
            .withFaceLandmarks()
            .withFaceDescriptor();

          if (result) descriptors.push(result.descriptor);
        } catch {
          continue;
        }
      }

      if (descriptors.length > 0) {
        labeled.push(new faceapi.LabeledFaceDescriptors(`${person.reg_number}|${person.name}`, descriptors));
      }
    }

    if (!labeled.length) {
      setMessage("No valid face descriptors could be created from stored student photos.");
      return false;
    }

    matcherRef.current = new faceapi.FaceMatcher(labeled, 0.52);
    return true;
  }

  async function markAttendanceByReg(regNo: string) {
    if (markingLockRef.current) return;
    if (markedRegsRef.current.has(regNo)) return;

    markingLockRef.current = true;
    const res = await fetch("/api/attendance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regNumber: regNo, classId: currentClassIdRef.current }),
    });
    const json = await res.json();
    if (res.ok) {
      markedRegsRef.current.add(regNo);
      setMessage(`Attendance marked for ${regNo}.`);
      await loadAttendance();
    } else {
      setMessage(json.error || "Auto attendance marking failed.");
    }
    markingLockRef.current = false;
  }

  async function startAttendanceCamera(durationOverrideMinutes?: number, classIdOverride?: number) {
    const rawDuration = durationOverrideMinutes ?? classDurationMinutes;
    const normalizedDuration = Number.isFinite(rawDuration) ? Math.max(1, Math.floor(rawDuration)) : 0;
    if (normalizedDuration <= 0) {
      setMessage("Enter a valid class duration (minutes).");
      return;
    }

    const thresholdMinutes = Math.max(1, Math.floor(normalizedDuration * 0.6));
    totalClassMsRef.current = normalizedDuration * 60_000;
    requiredPresenceMsRef.current = thresholdMinutes * 60_000;
    sessionStartRef.current = Date.now();
    presenceMsRef.current = new Map();
    markedRegsRef.current = new Set();
    setRequiredPresenceMinutes(thresholdMinutes);
    setElapsedMinutes(0);
    currentClassIdRef.current = classIdOverride ?? null;

    const matcherReady = await prepareMatcher();
    if (!matcherReady) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      recognitionStreamRef.current = stream;
      if (recognitionVideoRef.current) {
        recognitionVideoRef.current.srcObject = stream;
      }
      setRecognitionRunning(true);
      setMessage(
        `Attendance session started. Required presence is ${thresholdMinutes} min out of ${normalizedDuration} min.`
      );

      const faceapi = await ensureFaceApi();
      if (recognitionLoopRef.current) {
        window.clearInterval(recognitionLoopRef.current);
      }

      recognitionLoopRef.current = window.setInterval(async () => {
        const video = recognitionVideoRef.current;
        const canvas = recognitionCanvasRef.current;
        const matcher = matcherRef.current;
        if (!video || !canvas || !matcher || video.videoWidth === 0 || video.videoHeight === 0) return;

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const sessionStart = sessionStartRef.current ?? Date.now();
        const elapsedMs = Date.now() - sessionStart;
        const elapsedMin = Math.min(Math.floor(elapsedMs / 60_000), normalizedDuration);
        setElapsedMinutes(elapsedMin);

        if (elapsedMs >= totalClassMsRef.current) {
          stopAttendanceCamera();
          await finalizeClassIfNeeded(currentClassIdRef.current);
          return;
        }

        const detections = await faceapi
          .detectAllFaces(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
          .withFaceLandmarks()
          .withFaceDescriptors();

        const boxes: Array<{ x: number; y: number; width: number; height: number; label?: string; color: string }> = [];
        const recognizedThisFrame = new Set<string>();

        for (const detection of detections) {
          const best = matcher.findBestMatch(detection.descriptor);
          const isKnown = best.label !== "unknown";
          const [regNo, studentName] = isKnown ? best.label.split("|") : ["", "Unknown"];

          let presenceLabel = "";
          if (isKnown && regNo) {
            recognizedThisFrame.add(regNo);
            const currentMs = presenceMsRef.current.get(regNo) || 0;
            const currentMin = Math.floor(currentMs / 60_000);
            presenceLabel = ` ${currentMin}/${thresholdMinutes}m`;
          }

          boxes.push({
            x: detection.detection.box.x,
            y: detection.detection.box.y,
            width: detection.detection.box.width,
            height: detection.detection.box.height,
            label: isKnown ? `${studentName} (${regNo})${presenceLabel}` : "Unknown",
            color: isKnown ? "#34d399" : "#f87171",
          });
        }

        for (const regNo of recognizedThisFrame) {
          const prev = presenceMsRef.current.get(regNo) || 0;
          const next = prev + 700;
          presenceMsRef.current.set(regNo, next);
          if (next >= requiredPresenceMsRef.current) {
            void markAttendanceByReg(regNo);
          }
        }

        drawBoxes(canvas, boxes, [
          `${elapsedMin} min out of ${normalizedDuration} min`,
          `Required presence: ${thresholdMinutes} min (60%)`,
        ]);
      }, 700);
    } catch {
      setMessage("Unable to start attendance camera.");
    }
  }

  function stopAttendanceCamera() {
    if (recognitionLoopRef.current) {
      window.clearInterval(recognitionLoopRef.current);
      recognitionLoopRef.current = null;
    }
    if (recognitionStreamRef.current) {
      recognitionStreamRef.current.getTracks().forEach((t) => t.stop());
      recognitionStreamRef.current = null;
    }
    if (recognitionVideoRef.current) recognitionVideoRef.current.srcObject = null;
    if (recognitionCanvasRef.current) {
      const ctx = recognitionCanvasRef.current.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, recognitionCanvasRef.current.width, recognitionCanvasRef.current.height);
    }
    sessionStartRef.current = null;
    setRecognitionRunning(false);
    setCameraAutomationStatus((prev) =>
      prev && prev.status === "Running" ? { ...prev, status: "Stopped manually" } : prev
    );
  }

  return (
    <main className="mx-auto max-w-7xl p-4 md:p-8">
      {registrationPopup ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-emerald-300/40 bg-[#0c1d19] p-5 shadow-2xl">
            <h3 className="text-lg font-semibold text-emerald-200">Registration Complete</h3>
            <p className="mt-2 text-sm text-emerald-100">
              {registrationPopup.name} ({registrationPopup.regNumber}) has been registered.
            </p>
            <p className="mt-1 text-sm text-emerald-100">
              Model trained automatically at {new Date(registrationPopup.trainedAt).toLocaleString()}.
            </p>
            <button
              type="button"
              onClick={() => setRegistrationPopup(null)}
              className="mt-4 w-full rounded-xl bg-emerald-500/25 px-3 py-2 text-emerald-200"
            >
              OK
            </button>
          </div>
        </div>
      ) : null}

      <section className="fade-in mb-6 rounded-2xl glass p-6 md:p-8">
        <h1 className="text-3xl md:text-5xl font-bold tracking-tight">Face Attendance Console</h1>
        <p className="mt-2 text-sm md:text-base text-muted">
          Dark-mode web UI for student registration, training lock state, and attendance records.
        </p>
        <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3">
          {nextClass ? (
            <div className="text-sm">
              <p className="text-muted">
                Next class of <span className="text-white">{nextClass.class_name}</span> by{" "}
                <span className="text-white">{nextClass.teacher_name}</span> in
              </p>
              <p className="mt-1 font-mono text-xl text-accent">
                {formatCountdown(new Date(nextClass.class_start_at).getTime() - clockNowMs)}
              </p>
              <p className="mt-1 text-xs text-muted">
                Starts: {formatDateTime(new Date(nextClass.class_start_at))} | Ends:{" "}
                {formatDateTime(new Date(nextClass.class_end_at))}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted">No upcoming classes scheduled.</p>
          )}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowCreateClassForm((prev) => !prev)}
            className="rounded-xl bg-accent/20 px-4 py-2 text-accent cursor-pointer"
          >
            {showCreateClassForm ? "Close Create Class" : "Create Class"}
          </button>
        </div>
        {showCreateClassForm ? (
          <div className="mt-4 space-y-4">
            <form className="grid gap-3 md:grid-cols-2" onSubmit={createClass}>
              <input
                className="w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 outline-none focus:border-accent"
                placeholder="Teacher Name"
                value={teacherName}
                onChange={(e) => setTeacherName(e.target.value)}
                required
              />
              <input
                className="w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 outline-none focus:border-accent"
                placeholder="Teacher Unique ID"
                value={teacherUniqueId}
                onChange={(e) => setTeacherUniqueId(e.target.value)}
                required
              />
              <input
                className="w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 outline-none focus:border-accent"
                placeholder="Class Name"
                value={classNameInput}
                onChange={(e) => setClassNameInput(e.target.value)}
                required
              />
              <input
                type="number"
                min={1}
                step={1}
                className="w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 outline-none focus:border-accent"
                placeholder="Duration (minutes)"
                value={classDurationInput}
                onChange={(e) => setClassDurationInput(Number(e.target.value))}
                required
              />
              <input
                type="time"
                className="w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 outline-none focus:border-accent"
                value={classTimeInput}
                onChange={(e) => setClassTimeInput(e.target.value)}
                required
              />
              <button
                type="submit"
                disabled={creatingClass}
                className="w-full rounded-xl bg-ok/20 px-3 py-2 text-ok disabled:opacity-40"
              >
                {creatingClass ? "Creating..." : "Save Class"}
              </button>
            </form>

            {classProcessSteps.length > 0 ? (
              <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                <p className="text-sm text-muted">Class Setup Progress</p>
                <ul className="mt-2 space-y-2 text-sm">
                  {classProcessSteps.map((step) => (
                    <li key={step.key} className="rounded-lg border border-white/10 px-3 py-2">
                      <span className="font-medium">{step.label}</span>{" "}
                      <span className="text-xs text-muted">
                        {step.status === "done"
                          ? "Done"
                          : step.status === "active"
                            ? "In progress"
                            : step.status === "error"
                              ? "Failed"
                              : "Pending"}
                      </span>
                      {step.detail ? <p className="mt-1 text-xs text-muted">{step.detail}</p> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}

        {classes.length > 0 ? (
          <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3">
            <p className="text-sm text-muted">Upcoming Classes ({classes.length})</p>
            <div className="mt-2 overflow-auto">
              <table className="w-full text-xs">
                <thead className="text-muted">
                  <tr>
                    <th className="py-1 text-left">Class</th>
                    <th className="py-1 text-left">Teacher</th>
                    <th className="py-1 text-left">Teacher ID</th>
                    <th className="py-1 text-left">Start</th>
                  </tr>
                </thead>
                <tbody>
                  {classes.slice(0, 8).map((item) => (
                    <tr key={item.id} className="border-t border-white/10">
                      <td className="py-1">{item.class_name}</td>
                      <td className="py-1">{item.teacher_name}</td>
                      <td className="py-1 font-mono">{item.teacher_unique_id}</td>
                      <td className="py-1">{formatDateTime(new Date(item.class_start_at))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <article className="fade-in rounded-2xl glass p-5">
          <h2 className="text-xl font-semibold">Register Student</h2>
          <form className="mt-4 space-y-3" onSubmit={registerStudent}>
            <input
              className="w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 outline-none focus:border-accent"
              placeholder="Student Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
            <input
              className="w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 outline-none focus:border-accent"
              placeholder="Registration Number"
              value={regNumber}
              onChange={(e) => setRegNumber(e.target.value)}
              required
            />
            <input
              className="w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 outline-none focus:border-accent"
              placeholder="Telegram Chat ID (e.g. 123456789)"
              value={telegramId}
              onChange={(e) => setTelegramId(e.target.value)}
              required
            />
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={startRegistrationCamera} className="rounded-xl bg-accent/20 px-3 py-2 text-accent cursor-pointer">
                Start Camera
              </button>
              <button type="button" onClick={stopRegistrationCamera} className="rounded-xl bg-white/10 px-3 py-2 text-white cursor-pointer">
                Stop Camera
              </button>
              <button type="button" onClick={capturePhoto} disabled={!canCapture} className="rounded-xl bg-accent-2/20 px-3 py-2 text-accent-2 disabled:opacity-40 cursor-pointer">
                Capture
              </button>
              <button type="button" onClick={resetPhotos} className="rounded-xl bg-danger/20 px-3 py-2 text-danger cursor-pointer">
                Reset Photos
              </button>
            </div>
            <p className="text-sm text-muted">Captured: {photos.length}/10</p>
            <div className="relative">
              <video ref={registrationVideoRef} autoPlay playsInline muted className="w-full rounded-xl border border-white/10 bg-black/40" />
              <canvas ref={registrationCanvasRef} className="pointer-events-none absolute inset-0 h-full w-full rounded-xl" />
            </div>
            <button type="submit" disabled={saving} className="w-full rounded-xl bg-ok/20 px-3 py-2 text-ok disabled:opacity-40">
              {saving ? "Registering..." : "Register Student"}
            </button>
          </form>
        </article>

        <article className="fade-in rounded-2xl glass p-5">
          <h2 className="text-xl font-semibold">Train & Attendance</h2>
          <button onClick={trainModel} className="mt-4 w-full rounded-xl bg-accent/20 px-3 py-2 text-accent">
            Train Model
          </button>

          <div className="mt-6">
            <label className="block text-sm text-muted">Class Duration (minutes)</label>
            <input
              type="number"
              min={1}
              step={1}
              value={classDurationMinutes}
              onChange={(e) => setClassDurationMinutes(Number(e.target.value))}
              className="mt-2 w-full rounded-xl border border-white/15 bg-black/20 px-3 py-2 outline-none focus:border-accent"
            />
            <p className="mt-2 text-xs text-muted">
              Attendance rule: present for at least {requiredPresenceMinutes} out of {Math.max(1, Math.floor(classDurationMinutes || 1))} minutes.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={startAttendanceCamera}
                className="rounded-xl bg-accent/20 px-3 py-2 text-accent cursor-pointer"
              >
                Start Camera Attendance
              </button>
              <button
                type="button"
                onClick={stopAttendanceCamera}
                className="rounded-xl bg-white/10 px-3 py-2 text-white cursor-pointer"
              >
                Stop Camera
              </button>
            </div>
            <div className="relative mt-3">
              <video
                ref={recognitionVideoRef}
                autoPlay
                playsInline
                muted
                className="w-full rounded-xl border border-white/10 bg-black/40"
              />
              <canvas ref={recognitionCanvasRef} className="pointer-events-none absolute inset-0 h-full w-full rounded-xl" />
            </div>
            <p className="mt-2 text-xs text-muted">
              Status: {recognitionRunning ? `Live recognition running (${elapsedMinutes}/${Math.max(1, Math.floor(classDurationMinutes || 1))} min)` : "Camera attendance stopped"}
            </p>
            {cameraAutomationStatus ? (
              <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-muted">
                <p>Automation: {cameraAutomationStatus.status}</p>
                <p>Start: {cameraAutomationStatus.startAt}</p>
                <p>End: {cameraAutomationStatus.endAt}</p>
              </div>
            ) : null}
          </div>

          <p className="mt-6 rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-muted">{message || "System ready."}</p>
        </article>
      </section>

      <section className="mt-4 grid gap-4 md:grid-cols-2">
        <article className="fade-in rounded-2xl glass p-5 overflow-auto">
          <h3 className="text-lg font-semibold">Registered Students</h3>
          <table className="mt-3 w-full text-sm">
            <thead className="text-muted">
              <tr>
                <th className="py-2 text-left">Reg No</th>
                <th className="py-2 text-left">Name</th>
                <th className="py-2 text-left">Telegram</th>
                <th className="py-2 text-left">Trained</th>
              </tr>
            </thead>
            <tbody>
              {students.map((student) => (
                <tr key={student.reg_number} className="border-t border-white/8">
                  <td className="py-2 font-mono">{student.reg_number}</td>
                  <td className="py-2">{student.name}</td>
                  <td className="py-2 font-mono">{student.telegram_id}</td>
                  <td className="py-2">{student.model_trained ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>

        <article className="fade-in rounded-2xl glass p-5 overflow-auto">
          <h3 className="text-lg font-semibold">Attendance Records</h3>
          <table className="mt-3 w-full text-sm">
            <thead className="text-muted">
              <tr>
                <th className="py-2 text-left">Date</th>
                <th className="py-2 text-left">Reg No</th>
                <th className="py-2 text-left">Name</th>
                <th className="py-2 text-left">Time</th>
              </tr>
            </thead>
            <tbody>
              {attendance.map((row, idx) => (
                <tr key={`${row.reg_number}-${row.attendance_date}-${idx}`} className="border-t border-white/8">
                  <td className="py-2">{row.attendance_date}</td>
                  <td className="py-2 font-mono">{row.reg_number}</td>
                  <td className="py-2">{row.name}</td>
                  <td className="py-2">{row.time}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>
      </section>
    </main>
  );
}
