import React, { useEffect } from "react";
import { BluetoothProvider } from "./BluetoothContext";
import NMESControlPanel from "./NMESControl";

const App: React.FC = () => {
  useEffect(() => {
    const handleUnload = (event: Event) => {
      console.log("Tab is closing... Sending request to kill React process.");
  
      // Attempt sendBeacon first
      const success = navigator.sendBeacon("http://127.0.0.1:5000/kill-server");
  
      // If sendBeacon fails, use fetch with a delay
      if (!success) {
        setTimeout(() => {
          fetch("http://127.0.0.1:5000/kill-server", { method: "POST" })
            .then(response => response.text())
            .then(data => console.log("Kill-server response:", data))
            .catch(err => console.error("Error sending kill-server request:", err));
        }, 100); // Delay to allow the request to complete
      }
  
      // Ensure no default browser behavior interferes
      event.preventDefault();
    };
  
    window.addEventListener("beforeunload", handleUnload);
  
    return () => {
      window.removeEventListener("beforeunload", handleUnload);
    };
  }, []);
  
  return (
    <BluetoothProvider>
        <NMESControlPanel />
    </BluetoothProvider>
  );
};

export default App;
