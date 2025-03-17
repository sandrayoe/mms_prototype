import React, { createContext, useState, useContext, useRef } from "react";

// Define the Bluetooth context and its type
interface BluetoothContextType {
    connect: () => Promise<void>;
    disconnect: () => Promise<void>;
    isConnected: boolean;
    sendCommand: (...args: string[]) => void;
    stopStimulation: () => Promise<void>;
    runOptimizationLoop: (
      updateCurrentPair: (pair: [number, number]) => void,
      updateBestPair: (pair: [number, number]) => void,
      updateCurrentValue: (current: number) => void,
      updateBestCurrent: (current: number) => void, 
      minCurrent: number, 
      maxCurrent: number
    ) => Promise<void>;
    stopOptimizationLoop: () => Promise<void>;
    imuData: { imu1_changes: number[]; imu2_changes: number[] };
    startIMU: () => void;
    stopIMU: () => void;
    isOptimizationRunning: boolean; 
}

// Create the context
export const BluetoothContext = createContext<BluetoothContextType | undefined>(undefined);

export const BluetoothProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isConnected, setIsConnected] = useState(false);
  const [device, setDevice] = useState<BluetoothDevice | null>(null);
  const [rxCharacteristic, setRxCharacteristic] = useState<BluetoothRemoteGATTCharacteristic | null>(null);
  const [txCharacteristic, setTxCharacteristic] = useState<BluetoothRemoteGATTCharacteristic | null>(null);

  const deviceRef = useRef<BluetoothDevice | null>(null);
  const isManualDisconnectRef = useRef(false);

  const isOptimizationRunningRef = useRef(false); 
  const [isOptimizationRunning, setIsOptimizationRunning] = useState(false);

  const [imuData, setImuData] = useState<{ imu1_changes: number[]; imu2_changes: number[] }>({
    imu1_changes: [],
    imu2_changes: []
  });


  // Bluetooth service & characteristic UUIDs
  const SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e"; // Nordic UART Service
  const RX_CHARACTERISTIC_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e"; // Write characteristic (Send)
  const TX_CHARACTERISTIC_UUID = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"; // Notify characteristic (Receive)

  // Restore Bluetooth Functions
  const connect = async (): Promise<void> => {
    try {
      const selectedDevice = await navigator.bluetooth.requestDevice({
        filters: [{ name: "MMS nus" }],
        optionalServices: [SERVICE_UUID]
      });

      if (deviceRef.current) {
        deviceRef.current.removeEventListener("gattserverdisconnected", handleDisconnection);
      }

      const server = await selectedDevice.gatt?.connect();
      const service = await server?.getPrimaryService(SERVICE_UUID);
      const rxChar = await service?.getCharacteristic(RX_CHARACTERISTIC_UUID);
      const txChar = await service?.getCharacteristic(TX_CHARACTERISTIC_UUID);

      if (!rxChar) {
        console.error("❌ RX characteristic not found! Check UUID.");
      } else {
          console.log("✅ RX Characteristic Found.");
      }

      if (!txChar) {
          console.error("❌ TX characteristic not found! Check UUID.");
      } else {
          console.log("✅ TX Characteristic Found. Starting notifications...");
          await txChar.startNotifications();
          txChar.addEventListener("characteristicvaluechanged", handleIncomingData);
      }

      setRxCharacteristic(rxChar || null);
      setTxCharacteristic(txChar || null);
      setDevice(selectedDevice);
      deviceRef.current = selectedDevice;
      setIsConnected(true);

      console.log("✅ Connected to:", selectedDevice.name);
      selectedDevice.addEventListener("gattserverdisconnected", handleDisconnection);
    } catch (error) {
      console.error("❌ Bluetooth connection failed:", error);
    }
  };

  const disconnect = async (): Promise<void> => {
    if (deviceRef.current) {
      isManualDisconnectRef.current = true;
      deviceRef.current.removeEventListener("gattserverdisconnected", handleDisconnection);

      if (deviceRef.current.gatt?.connected) {
        deviceRef.current.gatt.disconnect();
        console.log("🔌 Device disconnected manually");
      }

      setIsConnected(false);
      setDevice(null);
      isManualDisconnectRef.current = false;
    }
  };

  // Handle unexpected disconnection
  const handleDisconnection = () => {
    if (isManualDisconnectRef.current) return;
    console.log("⚠️ Device disconnected unexpectedly");
    setIsConnected(false);
    setDevice(null);
  };

// idle value for IMU
const IDLE_VALUE = 2048;  

const handleIncomingData = async (event: any) => {
    //console.log("IMU Data Event Triggered");

    try {
        const target = event.target as BluetoothRemoteGATTCharacteristic;
        if (!target || !target.value) {
            console.warn("⚠️ Received event without a valid value.");
            return;
        }

        const value = target.value;
        const rawBytes = new Uint8Array(value.buffer);
        const dataView = new DataView(rawBytes.buffer);

        //console.log("Raw IMU Data (Uint8Array):", rawBytes);

        if (rawBytes.length % 4 !== 0) {
            console.warn("⚠️ Unexpected IMU data length:", rawBytes.length);
            return;
        }

        const sensor1Changes: number[] = [];  // Stores deviations from idle
        const sensor2Changes: number[] = [];  

        for (let i = 0; i < rawBytes.length; i += 4) {
            const sensor1Value = dataView.getUint16(i, true);
            const sensor2Value = dataView.getUint16(i + 2, true);

            // Calculate change (delta) from idle
            const sensor1Delta = Math.abs(sensor1Value - IDLE_VALUE);
            const sensor2Delta = Math.abs(sensor2Value - IDLE_VALUE);

            sensor1Changes.push(sensor1Delta);
            sensor2Changes.push(sensor2Delta);
        }

        //console.log("IMU1 Changes:", sensor1Changes, "IMU2 Changes:", sensor2Changes);

        setImuData({ imu1_changes: sensor1Changes, imu2_changes: sensor2Changes });

        //console.log("✅ IMU State Updated:", { imu1_changes: sensor1Changes, imu2_changes: sensor2Changes });

    } catch (error) {
        console.error("❌ Error processing IMU data:", error);
    }
};



  // Start IMU data streaming
  const startIMU = async () => {
      console.log("IMU Started");

      if (!txCharacteristic) {
          console.error("❌ TX characteristic not found!");
          return;
      }

      try {
          await sendCommand("b"); // Start IMU data streaming from the device
          txCharacteristic.addEventListener("characteristicvaluechanged", handleIncomingData);
          await txCharacteristic.startNotifications();
          console.log("✅ Listening for IMU data...");
      } catch (error) {
          console.error("❌ Failed to start IMU:", error);
      }
  };

  // Stop IMU data streaming
  const stopIMU = async () => {
      console.log("IMU Stopped");

      if (!txCharacteristic) return;

      try {
          await sendCommand("B"); // Stop IMU data streaming from the device
          txCharacteristic.removeEventListener("characteristicvaluechanged", handleIncomingData);
          await txCharacteristic.stopNotifications();
      } catch (error) {
          console.error("❌ Failed to stop IMU:", error);
      }
  };

  

  const sendCommand = async (...args: (string | number)[]) => {
    if (!rxCharacteristic) {
        console.error("❌ RX characteristic not found!");
        return;
    }

    const commandBytes = new Uint8Array(
      args.map((arg) =>
        typeof arg === "string" && !isNaN(Number(arg))
          ? parseInt(arg, 10) // ✅ Convert numeric strings to actual numbers
          : typeof arg === "string"
          ? arg.charCodeAt(0) // ✅ Convert single-character strings to a byte
          : arg // ✅ Keep numbers unchanged
      )
    );

    console.log(`📤 Sending Command as Bytes:`, commandBytes);
    await rxCharacteristic.writeValue(commandBytes);
};



  const stopStimulation = async () => {
    await sendCommand("e", "0", "0", "0", "0", "0");
  };

  const runOptimizationLoop = async (
    updateCurrentPair: (pair: [number, number]) => void,
    updateBestPair: (pair: [number, number]) => void,
    updateCurrentValue: (current: number) => void,
    updateBestCurrent: (current: number) => void, 
    minCurrent: number, 
    maxCurrent: number
    ) => {
        console.log("🔄 Starting local optimization...");
        setIsOptimizationRunning(true);
        isOptimizationRunningRef.current = true;

        // Start IMU if not already running
        if (imuData.imu1_changes.length === 0 && imuData.imu2_changes.length === 0) {
          console.log("📡 Starting IMU sensors before optimization...");
          startIMU();
          await new Promise(res => setTimeout(res, 500)); // Give some time for data to stream
        }

        const electrodePairs: [number, number][] = [];  // Generate 36 unique pairs from 9 electrodes
        for (let i = 1; i <= 9; i++) {
            for (let j = i + 1; j <= 9; j++) {
                electrodePairs.push([i, j]);
            }
        }

        let bestPair: [number, number] | null = null;
        let bestIntensity = minCurrent;

        while (isOptimizationRunningRef.current) {
            if (!isOptimizationRunningRef.current) break; 

            // Select a random electrode pair
            const newPair = electrodePairs[Math.floor(Math.random() * electrodePairs.length)];
            updateCurrentPair(newPair);

            // Adjust intensity using IMU data
            const imu1 = imuData.imu1_changes.reduce((a, b) => a + b, 0) / imuData.imu1_changes.length || 0;
            const imu2 = imuData.imu2_changes.reduce((a, b) => a + b, 0) / imuData.imu2_changes.length || 0;
            const imuVariation = Math.abs(imu1 - imu2);
            const newIntensity = Math.min(maxCurrent, Math.max(minCurrent, bestIntensity + imuVariation));

            updateCurrentValue(newIntensity);

            console.log(`⚡ Sending Stimulation: Pair (${newPair[0]}, ${newPair[1]}) at ${newIntensity} mA`);
            await new Promise(res => setTimeout(res, 500)); 

            // **Send Command to Bluetooth Device**
            //await sendCommand("e", newIntensity, 1, 4, "1", "0");
            await sendCommand("e", newIntensity, newPair[0], newPair[1], "1", "0"); // Adjust stimulation settings
            await new Promise(res => setTimeout(res, 500));  // Wait 500ms

            // Check if this is the best pair so far
            if (imuVariation > 5) {  // Adjust threshold as needed
                bestPair = newPair;
                bestIntensity = newIntensity;
                updateBestPair(newPair);
                updateBestCurrent(newIntensity);
            }

            // immediately stops optimization 
            if (!isOptimizationRunningRef.current) break;

            // **Stopping Condition**
            if (bestPair && bestIntensity >= maxCurrent) {
              isOptimizationRunningRef.current = false;
            }
        }

        console.log(`✅ Best Pair Found: (${bestPair?.[0]}, ${bestPair?.[1]}) at ${bestIntensity} mA`);
    };

    const stopOptimizationLoop = async () => {
        isOptimizationRunningRef.current = false; 
        setIsOptimizationRunning(false);
        await stopStimulation();
    };
    

  return (
    <BluetoothContext.Provider value={{
      connect,
      disconnect,
      isConnected,
      sendCommand,
      stopStimulation,
      runOptimizationLoop,
      stopOptimizationLoop,
      imuData,
      startIMU,
      stopIMU,
      isOptimizationRunning 
    }}>
      {children}
    </BluetoothContext.Provider>
  );
};

export const useBluetooth = () => {
  const context = useContext(BluetoothContext);
  if (!context) {
    throw new Error("useBluetooth must be used within a BluetoothProvider");
  }
  return context;
};