Output assets/demo.gif

Set Width 900
Set Height 550
Set FontSize 14
Set Theme "Dracula"
Set Padding 20
Set Framerate 24
Set PlaybackSpeed 1.0

# Start the simulation
Type "node assets/demo-sim.mjs"
Sleep 300ms
Enter

# Wait for startup sequence to finish (~4s)
Sleep 5000ms

# First recording: English → 中文
# Press SPACE to start recording
Space
Sleep 2500ms
# Press SPACE to stop recording
Space

# Wait for processing (1.2s) + result box + audio playback (2s)
Sleep 4200ms

# Second recording: 中文 → English
Space
Sleep 2000ms
Space

# Wait for processing (0.9s) + result box + audio playback (2s)
Sleep 3800ms

# Quit
Type "q"
Sleep 800ms
