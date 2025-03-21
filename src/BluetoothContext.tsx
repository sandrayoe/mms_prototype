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
  let pendingResolve: ((data: string) => void) | null = null;

  const handleCommandResponse = (message: string) => {
    console.log("📩 Command response received:", message);
    if (pendingResolve) {
        let resolver = pendingResolve;
        pendingResolve = null; 
        resolver(message);
    }
  };

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
    // ✅ Update IMU state separately
    setImuData({ imu1_changes: sensor1Changes, imu2_changes: sensor2Changes });

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
                ? [arg & 0xFF] // ✅ Send number as a raw byte
                : typeof arg === "string"
                ? arg.split("").map(char => char.charCodeAt(0)) // Convert string to ASCII
                : []
        )
    );

    //console.log(`📤 Sending Command as Raw Bytes:`, commandBytes);
    await rxCharacteristic.writeValue(commandBytes);
};





  const stopStimulation = async () => {
    await sendCommand("e", "0", "0", "0", "0", "0");
  };

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

  //Helper for Washout Filter
  function applyWashoutFilterToWindow(
      samples: number[],
      initialFiltered: number,
      h: number,
      dt: number,
      zeta: number
    ): number[] {
      let filteredValues: number[] = [];
      let currentFiltered = initialFiltered;
      for (let sample of samples) {
        currentFiltered = (1 - Math.exp(-h * dt)) * (sample - zeta) + Math.exp(-h * dt) * currentFiltered;
        filteredValues.push(currentFiltered);
      }
      return filteredValues;
    }

    type Coordinate = [number, number];

    //3x3 grid format
    const electrodeCoordinates: Record<number, Coordinate> = {
      1: [0, 0],
      2: [1, 0],
      3: [2, 0],
      4: [0, 1],
      5: [1, 1],
      6: [2, 1],
      7: [0, 2],
      8: [1, 2],
      9: [2, 2]
    };
    
    function calculateDistance(e1: number, e2: number): number {
      const [x1, y1] = electrodeCoordinates[e1];
      const [x2, y2] = electrodeCoordinates[e2];
      return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
    }
    

  const runOptimizationLoop = async (
    updateCurrentPair: (pair: [number, number]) => void,
    updateBestPair: (pair: [number, number]) => void,
    updateCurrentValue: (current: number) => void,
    updateBestCurrent: (current: number) => void,
    minCurrent: number,
    maxCurrent: number
  ) => {
      console.log("Starting SES Optimization...");
      setIsOptimizationRunning(true);
      isOptimizationRunningRef.current = true;
      await startIMU();
      await new Promise(res => setTimeout(res, 500)); // Delay to allow IMU data to populate
  
      // Start IMU if not already running
      //if (imuData.imu1_changes.length === 0 && imuData.imu2_changes.length === 0) {
          //console.log("📡 Starting IMU sensors before optimization...");
          //startIMU();
          //await new Promise(res => setTimeout(res, 500)); // Delay to allow IMU data to populate
      //}
  
      // Generate unique pairs of electrodes (9 electrodes → 36 pairs)
      const electrodePairs: [number, number][] = [];
      for (let i = 1; i <= 9; i++) {
          for (let j = i + 1; j <= 9; j++) {
              electrodePairs.push([i, j]);
          }
      }
      const numPairs = electrodePairs.length;
  
      // === SES PARAMETERS ===
      const lambdaDecay = 0.4;
      const qVariance = 0.7;
      const dt = 0.1;
      const numIterations = 50;
      const h = 2.5;  // Washout filter parameter
      const alpha = 0.1; // EMA smoothing factor

      let y_filtered = 0;  // Initialize washout filter
      let eta_ema = 0;  // Initialize EMA for perturbation
      let zeta = 0;  // Assume baseline IMU response is zero
  
      let bestPairStableThreshold = 5;

      const performanceMargin = 0.05;
      const learningRate = 25;
      const gradientThreshold = 0.5; // Minimum gradient magnitude to consider a pair sensitive (tune as needed)
      const gradientWeight = 0.7;     // Weight factor for the gradient contribution in the score
      const spatialWeight = 0.5; 
  
      // === INITIALIZATION ===
      let currentPairIndex = Math.floor(Math.random() * numPairs);
      let I_k = minCurrent;
      let eta = 0;
      let stabilityCounter = 0;

      const pairScores = new Array(numPairs).fill(0);
      let bestScore = -Infinity;
      let bestPairIndex = currentPairIndex;
  
      console.log(`🎯 Starting with Pair: ${electrodePairs[currentPairIndex]}, Current: ${I_k}mA`);
  
      for (let iteration = 0; iteration < numIterations && isOptimizationRunningRef.current; iteration++) {
          // === Stochastic Perturbation and EMA for Smoothing ===
          eta = eta - lambdaDecay * eta * dt + Math.sqrt(qVariance) * (Math.random() - 0.5);
          eta_ema = alpha * eta + (1 - alpha) * eta_ema;

          // Perturb electrode pair index
          // If not locked in, perturb the electrode pair index; otherwise, lock in the best pair.
          let eta_noise = Math.sqrt(qVariance) * (Math.random() - 0.5);
          let perturbedIndex = Math.floor(Math.max(0, Math.min(numPairs - 1, currentPairIndex + eta_noise * numPairs)));
          currentPairIndex = perturbedIndex;
          let newPair = electrodePairs[currentPairIndex];

          // ✅ Immediately send the new pair to BLE
          console.log(`⚡ Sending New Pair to BLE: (${newPair[0]}, ${newPair[1]}) at ${I_k}mA`);
          await sendCommand("e", I_k, newPair[0], newPair[1], 1, 0);
          updateCurrentPair(newPair); 

          // === Measure muscle activation using IMU ===
          const windowSize = 5;
          let recentIMU1 = imuData.imu1_changes.slice(-windowSize);
          let recentIMU2 = imuData.imu2_changes.slice(-windowSize);
          
          let filteredIMU1 = applyWashoutFilterToWindow(recentIMU1, 0, h, dt, zeta);
          let filteredIMU2 = applyWashoutFilterToWindow(recentIMU2, 0, h, dt, zeta);
          
          let avgFilteredIMU1 = filteredIMU1.length ? filteredIMU1.reduce((sum, val) => sum + val, 0) / filteredIMU1.length : 0;
          let avgFilteredIMU2 = filteredIMU2.length ? filteredIMU2.reduce((sum, val) => sum + val, 0) / filteredIMU2.length : 0;
          
          let newActivation = Math.max(Math.abs(avgFilteredIMU1), Math.abs(avgFilteredIMU2));

          // === Washout Filter (High-Pass Filter) ===
          y_filtered = (1 - Math.exp(-h * dt)) * (newActivation - zeta) + Math.exp(-h * dt) * y_filtered;
  
           // === Compute the Gradient Estimate and Combined Score ===
          let gradientEstimate = eta_ema * y_filtered;
          // Optionally, enforce a minimum gradient threshold:
          let effectiveGradient = Math.abs(gradientEstimate) >= gradientThreshold ? Math.abs(gradientEstimate) : 0;
          // Spatial component:
          let distance = calculateDistance(newPair[0], newPair[1]);
          let spatialScore = 1 / (distance + 1);

          // Combined score: activation performance + weighted gradient + weighted spatial proximity
          let pairScore = y_filtered + gradientWeight * effectiveGradient + spatialWeight * spatialScore;

          // === Update Electrode Pair Performance Based on Combined Score ===
          if (pairScore >= bestScore - performanceMargin) {
            // Update bestScore if this pair is truly better
            if (pairScore > bestScore) {
              bestScore = pairScore;
              bestPairIndex = currentPairIndex;
            }
            stabilityCounter++; // Increment counter because the best pair is still good
          } else {
            stabilityCounter = 0; // Reset counter if performance dips
          }
          if (stabilityCounter >= bestPairStableThreshold) {
            console.log(`✅ Best pair determined: ${electrodePairs[bestPairIndex]}.`);
            await stopOptimizationLoop();
            updateBestPair(electrodePairs[bestPairIndex]);
            updateBestCurrent(I_k);
            return;
          }

          // === Update Current Using Gradient Estimate ===
          I_k = Math.min(maxCurrent, Math.max(minCurrent, I_k + learningRate * gradientEstimate));
          I_k = Math.round(I_k); // Ensure current is an integer
          updateCurrentValue(I_k);

          // === Stopping Conditions ===
          if (I_k - 1 >= maxCurrent) {
            console.log(`⚡ Maximum current reached (${maxCurrent}mA). Stopping optimization.`);
            await stopOptimizationLoop();
            updateBestPair(electrodePairs[currentPairIndex]);
            updateBestCurrent(I_k);
            return;
          }

          await new Promise(res => setTimeout(res, 700)); // delay 700ms before the next iteration
      }
      console.log(`Optimization Complete. Best Pair: ${electrodePairs[currentPairIndex]}, Final Current: ${I_k}mA`);
      await stopOptimizationLoop();
      updateBestPair(electrodePairs[currentPairIndex]);
      updateBestCurrent(I_k); 
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