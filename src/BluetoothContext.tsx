import React, { createContext, useState, useContext, useRef, useEffect } from "react";

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
    initializeDevice: () => void; 
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

  const isInitializingRef = useRef<boolean>(false);

  const isOptimizationRunningRef = useRef(false); 
  const [isOptimizationRunning, setIsOptimizationRunning] = useState(false);

  const [imuData, setImuData] = useState<{ imu1_changes: number[]; imu2_changes: number[] }>({
    imu1_changes: [],
    imu2_changes: []
  });
  const imuDataRef = useRef(imuData);
  useEffect(() => {
    imuDataRef.current = imuData;
  }, [imuData]);

  // Bluetooth service & characteristic UUIDs
  const SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e"; // Nordic UART Service
  const RX_CHARACTERISTIC_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e"; // Write characteristic (Send)
  const TX_CHARACTERISTIC_UUID = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"; // Notify characteristic (Receive)

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
  
  const IDLE_VALUE = 2048;  // idle value for IMU
  let pendingResolve: ((data: string) => void) | null = null;

  const handleCommandResponse = (message: string) => {
    console.log("📩 Command response received:", message);
    if (pendingResolve) {
        let resolver = pendingResolve;
        pendingResolve = null; 
        resolver(message);
    }
  };

  const maxHistory = 500; // max history for the IMU data

  const handleIMUData = (rawBytes: Uint8Array) => {

    try {
      const dataView = new DataView(rawBytes.buffer);
      const sensor1Changes: number[] = [];
      const sensor2Changes: number[] = [];

      for (let i = 0; i < rawBytes.length; i += 4) {
          const sensor1Value = dataView.getUint16(i, true);
          const sensor2Value = dataView.getUint16(i + 2, true);

          // Calculate change (delta) from idle value
          const sensor1Delta = Math.abs(sensor1Value - IDLE_VALUE);
          const sensor2Delta = Math.abs(sensor2Value - IDLE_VALUE);

          sensor1Changes.push(sensor1Delta);
          sensor2Changes.push(sensor2Delta);
    }
    // Update IMU state separately
    setImuData(prev => ({
      imu1_changes: [...prev.imu1_changes, ...sensor1Changes].slice(-maxHistory),
      imu2_changes: [...prev.imu2_changes, ...sensor2Changes].slice(-maxHistory)
    }));

    } catch (error) {
      console.error("❌ Error processing IMU data:", error);
    }
      
  };

  const handleIncomingData = (event: any) => {
    const target = event.target as BluetoothRemoteGATTCharacteristic;
    if (!target || !target.value) {
        console.warn("⚠️ Received event without a valid value.");
        return;
    }
    const value = target.value;
    const rawBytes = new Uint8Array(value.buffer);
    //console.log("📩 Incoming BLE data:", new TextDecoder().decode(event.target.value.buffer));

    if (isInitializingRef.current) {
      let message = new TextDecoder().decode(rawBytes);
      handleCommandResponse(message);
      return; 
    } 

    handleIMUData(rawBytes);
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
        args.flatMap(arg =>
            typeof arg === "number"
                ? [arg & 0xFF] // Send number as a raw byte
                : typeof arg === "string"
                ? arg.split("").map(char => char.charCodeAt(0)) // Convert string to ASCII
                : []
        )
    );
    //console.log(`📤 Sending Command as Raw Bytes:`, commandBytes);
    await rxCharacteristic.writeValue(commandBytes);
};


  const stopStimulation = async () => {
    await sendCommand("e", "0", "0", "0", "0", "0"); //command to stop the stimulation in CU
  };

  // extra function for the response if there are some parameters' changes in CU
  function waitForDeviceResponse(expectedCmd: string, delay: number = 1000): Promise<string> {
    return new Promise((resolve) => {
        const expected = expectedCmd.trim().toLowerCase();
        let resolved = false;

        const timeoutId = setTimeout(() => {
            if (!resolved) {
                resolve("No response received");
            }
        }, delay);

        const handleResponse = (response: string) => {
            if (!resolved) {
                clearTimeout(timeoutId);
                const resp = response.trim().toLowerCase();
                resolved = true;
                resolve(resp.startsWith(expected) ? response : `Unexpected response: ${response}`);
            }
        };

        //pendingResolve = handleResponse; // Store the function for use when response arrives
    });
  }

  const initializationConfig = [
    { cmd: "f", value: 35 },  // frequency
    { cmd: "d", value: 7 }, // phase duration
    { cmd: "o", value: 5 },   // ON time
    { cmd: "O", value: 10 },   // OFF time
    { cmd: "r", value: 0 },  // ramp-up time
    { cmd: "R", value: 0 }    // ramp-down time
  ];

  // Initialize device parameters (that need to be set)
  const initializeDevice = async() =>{

    if (!txCharacteristic) {
      console.error("❌ TX characteristic not found!");
      return;
    }

    try {
        isInitializingRef.current = true;
        console.log("Initializing device parameters...");
        const padValue = (num: number): string => num < 10 ? "0" + num : num.toString();
    
        for (const { cmd, value } of initializationConfig) {
          console.log(`Sending command '${cmd}'`);
          const responsePromise = waitForDeviceResponse(cmd, 1000);
          await sendCommand(cmd, padValue(value), "0");
          await responsePromise;
        }
    
        await sendCommand("s");
        isInitializingRef.current = false;
        await new Promise((res) => setTimeout(res, 500));

    } catch (error) {
        console.error("❌ Failed to initialize:", error);
    }
  }

    function nonlinearTransform(
      window: number[],
      power: number = 1.5,
      gain: number = 1
    ): number[] {
      return window.map(v => {
        const transformed = Math.pow(Math.abs(v), power);
        return Math.sign(v) * transformed * gain;
      });
    }

    function contrastRMS(window: number[]): number {
      if (window.length === 0) return 0;
      
      const absValues = window.map(Math.abs);
      const max = Math.max(...absValues);
      const mean = absValues.reduce((sum, v) => sum + v, 0) / absValues.length;
      
      return max - mean; // Peak-to-average gap
    }

    // Helper function to create a combined electrode stats tracker
    interface ElectrodeStats {
      usage: number;
      aggregatedScore: number;
      scores: number[];
      averageScore: number; 
    }
    
    const createElectrodeStatsTracker = (numElectrodes: number): Record<number, ElectrodeStats> => {
      const tracker: Record<number, ElectrodeStats> = {};
      for (let i = 1; i <= numElectrodes; i++) {
        tracker[i] = {
          usage: 0,
          aggregatedScore: 0,
          scores: [],
          averageScore: 0,
        };
      }
      return tracker;
    };
    
    const updateElectrodeStats = (
      tracker: Record<number, ElectrodeStats>,
      pair: [number, number],
      pairScore: number
    ): void => {
      pair.forEach(electrode => {
        tracker[electrode].usage++;
        tracker[electrode].aggregatedScore += pairScore;
        tracker[electrode].scores.push(pairScore);
        // Update the average score; avoid division by zero
        tracker[electrode].averageScore = tracker[electrode].usage > 0 
          ? tracker[electrode].aggregatedScore / tracker[electrode].usage 
          : 0;
      });
    };

    function mean(arr: number[]): number {
      if (arr.length === 0) return 0;
      return arr.reduce((sum, val) => sum + val, 0) / arr.length;
    }

    const runOptimizationLoop = async (
      updateCurrentPair: (pair: [number, number]) => void,
      updateBestPair: (pair: [number, number]) => void,
      updateCurrentValue: (current: number) => void,
      updateBestCurrent: (current: number) => void,
      minCurrent: number,
      maxCurrent: number
    ) => {
      console.log("Starting SES Optimization with locked current phase...");
      setIsOptimizationRunning(true);
      isOptimizationRunningRef.current = true;
      await startIMU();
      await new Promise((res) => setTimeout(res, 500)); // Allow time for IMU data to populate
    
      // Generate unique electrode pairs (9 electrodes → 36 pairs)
      const electrodePairs: [number, number][] = [];
      const numElectrodes = 9;
      for (let i = 1; i <= numElectrodes; i++) {
        for (let j = i + 1; j <= numElectrodes; j++) {
          electrodePairs.push([i, j]);
        }
      }
      const numPairs = electrodePairs.length;
    
      // === SES PARAMETERS ===
      const lambdaDecay = 0.4;
      const qVariance = 0.8;
      const dt = 0.1;
      const numIterations = 100; // Maximum iterations for current search
      const alpha = 0.1;       // EMA smoothing factor
      let stableGradientCount = 3;       // Tracks how many times the gradient was consistently small
      const gradientStabilityThreshold = 15.0;      // Above this, gradient is considered "stable"
      const consecutiveStableCount = 3; 
      let triesAtCurrentLevel = 0;     
    
      // Initialize variables 
      let eta = 0;           // Perturbation variable
      let eta_ema = 0;       // EMA for smoothing the perturbation
    
      // === INITIALIZATION ===
      let currentPairIndex = Math.floor(Math.random() * numPairs);
      let I_k = minCurrent;
      console.log(`Phase 1: Starting with Pair: ${electrodePairs[currentPairIndex]}, Current: ${I_k}mA`);

      if (minCurrent == maxCurrent) { 
        console.log("⚠️ Current level fixed. Skipping Phase 1.");
      } else {
      
      // Phase 1: Optimize current level until gradient threshold is consistently met
      for (let iteration = 0; iteration < numIterations && isOptimizationRunningRef.current; iteration++) {
        // --- Stochastic Perturbation and EMA Smoothing ---
        eta = eta - lambdaDecay * eta * dt + Math.sqrt(qVariance) * (Math.random() - 0.5);
        eta_ema = alpha * eta + (1 - alpha) * eta_ema;
      
        // Randomly perturb the electrode pair index
        const eta_noise = Math.sqrt(qVariance) * (Math.random() - 0.5);
        currentPairIndex = Math.floor(
          Math.max(0, Math.min(numPairs - 1, currentPairIndex + eta_noise * numPairs))
        );
        const newPair = electrodePairs[currentPairIndex];
      
        // Send the new pair to BLE and update UI
        console.log(`Sending Pair (${newPair[0]}, ${newPair[1]}) at ${I_k}mA`);
        await sendCommand("e", I_k, newPair[0], newPair[1], 1, 0);
        await new Promise((res) => setTimeout(res, 700));
        updateCurrentPair(newPair);
      
        // --- Measure Muscle Activation using IMU Data ---
        const windowSize = 10;
        const recentIMU1 = imuDataRef.current.imu1_changes.slice(-windowSize);
        const recentIMU2 = imuDataRef.current.imu2_changes.slice(-windowSize);
        const nonLinIMU1 = nonlinearTransform(recentIMU1, 1.5, 1); 
        const nonLinIMU2 = nonlinearTransform(recentIMU2, 1.5, 1); 
        const rmsIMU1 = contrastRMS(nonLinIMU1);
        const rmsIMU2 = contrastRMS(nonLinIMU2);
        const newActivation = Math.max(Math.abs(rmsIMU1), Math.abs(rmsIMU2));
      
        // --- Compute the Gradient Estimate ---
        const gradientEstimate = Math.abs(eta_ema * newActivation);
        console.log(`Gradient Estimate: ${gradientEstimate}`);
      
        triesAtCurrentLevel++;
      
        if (gradientEstimate >= gradientStabilityThreshold) {
          stableGradientCount++;
          console.log(`Stable gradient (${stableGradientCount}/${consecutiveStableCount})`);
      
          if (stableGradientCount >= consecutiveStableCount) {
            console.log("✅ Gradient stable — locking in current level.");
            break;
          }
        } else {
          stableGradientCount = 0;
        }
      
        if (triesAtCurrentLevel >= 3 && stableGradientCount === 0) {
          if (I_k >= maxCurrent) {
            console.log("⚠️ Reached max current level — locking at", I_k, "mA without stable gradient.");
            break;
          }

          I_k = Math.min(maxCurrent, I_k + 1);
          updateCurrentValue(I_k);
          console.log("⏫ No stable gradient after 3 tries — incrementing current to", I_k);
      
          triesAtCurrentLevel = 0;
        }
      }   
    
      // --- Phase 1 Complete: Current is Locked In ---
      console.log(`Locked current level: ${I_k}mA. Entering Phase 2 for electrode stats update.`);

      }
    
      // --- Phase 2: Electrode Stats Update with Locked Current ---
      const statsTracker = createElectrodeStatsTracker(numElectrodes); 

      while (isOptimizationRunningRef.current) {
        // Randomly perturb the electrode pair index
        const eta_noise = Math.sqrt(qVariance) * (Math.random() - 0.5);
        currentPairIndex = Math.floor(
          Math.max(0, Math.min(numPairs - 1, currentPairIndex + eta_noise * numPairs))
        );
        const lockedPair = electrodePairs[currentPairIndex];
        
        console.log(`Phase 2: Sending Pair (${lockedPair[0]}, ${lockedPair[1]}) at ${I_k}mA`);
        await sendCommand("e", I_k, lockedPair[0], lockedPair[1], 1, 0);
        await new Promise((res) => setTimeout(res, 700));
        updateCurrentPair(lockedPair);

        // Measure activation using recent IMU data
        const windowSize = 10;
        const recentIMU1 = imuDataRef.current.imu1_changes.slice(-windowSize);
        const recentIMU2 = imuDataRef.current.imu2_changes.slice(-windowSize);
        const nonLinIMU1 = nonlinearTransform(recentIMU1, 1.5, 1); 
        const nonLinIMU2 = nonlinearTransform(recentIMU2, 1.5, 1); 
        const rmsIMU1 = contrastRMS(nonLinIMU1);
        const rmsIMU2 = contrastRMS(nonLinIMU2);
        const newActivation = Math.max(Math.abs(rmsIMU1),Math.abs(rmsIMU2));
        const pairScore = newActivation;

        updateElectrodeStats(statsTracker, lockedPair, pairScore);

        let scoreGapCondition = false;

        // === Stopping Condition Check ===
        const allElectrodesTriedMinimumTimes = Object.values(statsTracker).every(
          (stat) => stat.usage >= 7
        );

        if (allElectrodesTriedMinimumTimes) {
          const sortedElectrodes = Object.entries(statsTracker)
            .map(([electrode, stats]) => ({
              electrode: Number(electrode),
              averageScore: stats.averageScore,
            }))
            .sort((a, b) => b.averageScore - a.averageScore);
        
          if (sortedElectrodes.length >= 6) {
            const top4 = sortedElectrodes.slice(0, 4);
            const rest = sortedElectrodes.slice(4);
        
            const top4Avg = mean(top4.map(e => e.averageScore));
            const restScores = rest.map(e => e.averageScore);
            const restMean = mean(restScores);
        
            const k = 5.0; // Adjust 
            scoreGapCondition = top4Avg > (restMean + 3.5);
        
            console.log(`Top4 Avg: ${top4Avg.toFixed(2)}, Rest Mean: ${restMean.toFixed(2)}`);
        
            if (scoreGapCondition) {
              const bestPair: [number, number] = [top4[0].electrode, top4[1].electrode];
              console.log("✅ Stopping Phase 2: Top 4 are 'proven' better. Best Pair:", bestPair);
              updateBestPair(bestPair);
              updateBestCurrent(I_k);
              break;
            }
          }
        }        
      }

      // Send the final electrode stats to a backend
      console.log("Final electrode stats after locked phase:", statsTracker);
      try {
        const response = await fetch("http://localhost:5000/save-electrode-stats", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(statsTracker),
        });
        const data = await response.json();
        console.log(data.message);
      } catch (error) {
        console.error("Error sending electrode stats:", error);
      }

      await stopOptimizationLoop();
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
      isOptimizationRunning, 
      initializeDevice 
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