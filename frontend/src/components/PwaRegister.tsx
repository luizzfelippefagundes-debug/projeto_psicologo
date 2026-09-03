"use client";

import { useEffect } from "react";

export function PwaRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // instalação do PWA não funciona sem isso, mas não deve quebrar o resto do app
      });
    }
  }, []);

  return null;
}
