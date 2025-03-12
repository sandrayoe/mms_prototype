// Store the bluetooth devices and connection state
import React, { createContext, useState, useContext, useEffect, useRef } from "react";

// Define the Bluetooth context and its type
interface BluetoothContextType {
    connect: () => Promise<void>;
    disconnect: () => void;
    isConnected: boolean;
}

// Create the context
export const BluetoothContext = createContext<BluetoothContextType | undefined>(undefined);

export const BluetoothProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isConnected, setIsConnected] = useState(false);
  const [device, setDevice] = useState<BluetoothDevice | null>(null);
  const deviceRef = useRef<BluetoothDevice | null>(null);  // Store device reference
  const isManualDisconnectRef = useRef(false); // Store manual disconnect flag

  // Function to handle unexpected disconnection
  const handleDisconnection = () => {
    if (isManualDisconnectRef.current) {
      return; // Ignore if the disconnection was manual
    }
    console.log("Device disconnected unexpectedly");
    setIsConnected(false);
    setDevice(null);
  };

  // Function to connect to a Bluetooth device
  const connect = async () => {
    try {
      const selectedDevice = await navigator.bluetooth.requestDevice({
        filters: [{ name: "MMS nus" }],
        optionalServices: ["6e400001-b5a3-f393-e0a9-e50e24dcca9e"] // UUID to retrieve TX characteristic
      });

      // Clean up previous event listener if device already connected
      if (deviceRef.current) {
        deviceRef.current.removeEventListener("gattserverdisconnected", handleDisconnection);
      }

      await selectedDevice.gatt?.connect();
      setDevice(selectedDevice);
      deviceRef.current = selectedDevice;
      setIsConnected(true);

      console.log("Connected to:", selectedDevice.name);

      // Add the event listener for unexpected disconnection
      selectedDevice.addEventListener("gattserverdisconnected", handleDisconnection);

    } catch (error) {
      console.error("Bluetooth connection failed:", error);
    }
  };

  // Function to disconnect from Bluetooth
  const disconnect = () => {
    if (deviceRef.current) {
      isManualDisconnectRef.current = true; // Mark this as a manual disconnect

      // Remove the event listener before disconnecting
      deviceRef.current.removeEventListener("gattserverdisconnected", handleDisconnection); 

      if (deviceRef.current.gatt?.connected) {
        deviceRef.current.gatt.disconnect();
        console.log("Device disconnected manually");
      }

      setIsConnected(false);
      setDevice(null);

      isManualDisconnectRef.current = false; // Reset the flag
    }
  };

  // Automatically disconnect on tab close
  useEffect(() => {
    const handleUnload = () => {
      disconnect();
    };

    window.addEventListener("beforeunload", handleUnload);

    return () => {
      window.removeEventListener("beforeunload", handleUnload);
      disconnect();
    };
  }, []);

  return (
    <BluetoothContext.Provider value={{ connect, disconnect, isConnected }}>
      {children}
    </BluetoothContext.Provider>
  );
};

// Custom hook to use Bluetooth context
export const useBluetooth = (): BluetoothContextType => {
  const context = useContext(BluetoothContext);
  if (!context) {
    throw new Error("useBluetooth must be used within a BluetoothProvider");
  }
  return context;
};




