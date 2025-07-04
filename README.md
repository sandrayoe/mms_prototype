# mms_prototype
Only for prototyping
Based: React (TypeScript)


See other branches for each version

Main program is located in src-BluetoothContext.tsx

Main algorithm is inside the runOptimizationLoop function. Application of SES algorithm but with statistical checking: the electrodes must satisfy the minimum 'Usage' requirements. 'Usage' = minimum trial of each electrode. 

Ver1 & 2 - UI almost ready, much earlier release of the search algorithm (pure SES)

Ver3 - Added initialization, algorithm modified

Ver4 - Added electrodeStats to track the scores of each electrode, then converted into a .json file. (.json file can then be processed again to the spreadsheet to create a heatmap)

Ver5 - Stable enough version, will be modified more later to adjust the parameters

Ver6 - Updated current search, update electrodeStats filenames

Ver7 - Added Wavelet Transform, fixed current level search

Ver 8 - Adjusted wavelet, simplification of the algorithm

Final report accessible in kth-diva later. 
