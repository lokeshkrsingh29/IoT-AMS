"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

type FaceApiModule = typeof import("@vladmandic/face-api");

type ScheduledClass = {
  id: number;
  class_name: string;
  duration_minutes: number;
  class_start_at: string;
  class_end_at: string;
};

type RecognitionDatasetRow = {
  reg_number: string;
  name: string;
  photo_urls: string[];
};

export default function AutoAttendanceAgent() {
  const pathname = usePathname();
  const runningClassIdRef = useRef<number | null>(null);
  const runningClassEndMsRef = useRef(0);
  const classDurationRef = useRef(0);
  const faceApiRef = useRef<FaceApiModule | null>(null);
  const matcherRef = useRef<InstanceType<FaceApiModule["FaceMatcher"]> | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const loopRef = useRef<number | null>(null);
  const requiredPresenceMsRef = useRef(0);
  const presenceMsRef = useRef<Map<string, number>>(new Map());
  const markedRegsRef = useRef<Set<string>>(new Set());
  const finalizedClassesRef = useRef<Set<number>>(new Set());
  const bootingRef = useRef(false);
  const lastStartAttemptMsRef = useRef(0);

  async function ensureFaceApi() {
    if (faceApiRef.current) return faceApiRef.current;
    const faceApiModule = await import("@vladmandic/face-api");
    faceApiRef.current = faceApiModule;
    return faceApiModule;
  }

  async function ensureModelsLoaded() {
    const faceapi = await ensureFaceApi();
    if ((faceapi.nets.tinyFaceDetector.params as unknown) && (faceapi.nets.faceRecognitionNet.params as unknown)) {
      return true;
    }

    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri("/models"),
      faceapi.nets.faceLandmark68Net.loadFromUri("/models"),
      faceapi.nets.faceRecognitionNet.loadFromUri("/models"),
    ]);
    return true;
  }

  async function prepareMatcher() {
    const loaded = await ensureModelsLoaded();
    if (!loaded) return false;

    const datasetRes = await fetch("/api/recognition-dataset");
    const datasetJson = await datasetRes.json();
    if (!datasetRes.ok) return false;

    const dataset = (datasetJson.dataset || []) as RecognitionDatasetRow[];
    if (!dataset.length) return false;

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

    if (!labeled.length) return false;
    matcherRef.current = new faceapi.FaceMatcher(labeled, 0.52);
    return true;
  }

  async function markAttendance(regNo: string, classId: number) {
    if (markedRegsRef.current.has(regNo)) return;
    const res = await fetch("/api/attendance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regNumber: regNo, classId }),
    });
    if (res.ok) {
      markedRegsRef.current.add(regNo);
    }
  }

  async function finalizeClass(classId: number) {
    if (finalizedClassesRef.current.has(classId)) return;
    finalizedClassesRef.current.add(classId);
    await fetch("/api/classes/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classId }),
    });
  }

  async function stopRunning(finalize = true) {
    if (loopRef.current) {
      window.clearInterval(loopRef.current);
      loopRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current = null;
    }

    const classId = runningClassIdRef.current;
    runningClassIdRef.current = null;
    runningClassEndMsRef.current = 0;
    classDurationRef.current = 0;
    presenceMsRef.current = new Map();
    markedRegsRef.current = new Set();

    if (finalize && classId) {
      await finalizeClass(classId);
    }
  }

  async function startForClass(item: ScheduledClass) {
    if (bootingRef.current) return;
    if (runningClassIdRef.current === item.id) return;

    const now = Date.now();
    if (now - lastStartAttemptMsRef.current < 5000) return;
    lastStartAttemptMsRef.current = now;

    bootingRef.current = true;
    try {
      const matcherReady = await prepareMatcher();
      if (!matcherReady) return;

      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      const video = document.createElement("video");
      video.playsInline = true;
      video.muted = true;
      video.autoplay = true;
      video.srcObject = stream;
      await video.play();

      videoRef.current = video;
      streamRef.current = stream;
      runningClassIdRef.current = item.id;
      runningClassEndMsRef.current = new Date(item.class_end_at).getTime();
      classDurationRef.current = Math.max(1, Math.floor(Number(item.duration_minutes) || 1));

      const thresholdMinutes = Math.max(1, Math.floor(classDurationRef.current * 0.6));
      requiredPresenceMsRef.current = thresholdMinutes * 60_000;
      presenceMsRef.current = new Map();
      markedRegsRef.current = new Set();

      const faceapi = await ensureFaceApi();
      loopRef.current = window.setInterval(async () => {
        const classId = runningClassIdRef.current;
        const matcher = matcherRef.current;
        const currentVideo = videoRef.current;
        if (!classId || !matcher || !currentVideo || currentVideo.videoWidth === 0 || currentVideo.videoHeight === 0) {
          return;
        }

        if (Date.now() >= runningClassEndMsRef.current) {
          await stopRunning(true);
          return;
        }

        const detections = await faceapi
          .detectAllFaces(currentVideo, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
          .withFaceLandmarks()
          .withFaceDescriptors();

        const recognized = new Set<string>();
        for (const detection of detections) {
          const best = matcher.findBestMatch(detection.descriptor);
          if (best.label !== "unknown") {
            const [regNo] = best.label.split("|");
            if (regNo) recognized.add(regNo);
          }
        }

        for (const regNo of recognized) {
          const prev = presenceMsRef.current.get(regNo) || 0;
          const next = prev + 700;
          presenceMsRef.current.set(regNo, next);
          if (next >= requiredPresenceMsRef.current) {
            void markAttendance(regNo, classId);
          }
        }
      }, 700);
    } catch {
      await stopRunning(false);
    } finally {
      bootingRef.current = false;
    }
  }

  async function syncActiveClass() {
    if (pathname === "/workspace") return;

    const res = await fetch("/api/classes?upcoming=1");
    const json = await res.json();
    if (!res.ok) return;

    const classes = (json.classes || []) as ScheduledClass[];
    const now = Date.now();
    const active = classes
      .filter((item) => {
        const start = new Date(item.class_start_at).getTime();
        const end = new Date(item.class_end_at).getTime();
        return start <= now && now < end;
      })
      .sort((a, b) => new Date(a.class_start_at).getTime() - new Date(b.class_start_at).getTime())[0];

    if (active) {
      if (runningClassIdRef.current !== active.id) {
        await stopRunning(false);
        await startForClass(active);
      }
    } else if (runningClassIdRef.current) {
      await stopRunning(true);
    }
  }

  useEffect(() => {
    const poll = window.setInterval(() => {
      void syncActiveClass();
    }, 4000);

    const boot = window.setTimeout(() => {
      void syncActiveClass();
    }, 500);

    return () => {
      window.clearInterval(poll);
      window.clearTimeout(boot);
      void stopRunning(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return null;
}
