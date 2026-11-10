param([string]$combo = 'circle')
$def = @'
using System;
using System.Runtime.InteropServices;
public static class Kb2 {
  [DllImport("user32.dll")]
  public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
}
'@
Add-Type -TypeDefinition $def
$KEYUP = 0x2
function Tap([byte]$vk) { [Kb2]::keybd_event($vk, 0, 0, [UIntPtr]::Zero); [Kb2]::keybd_event($vk, 0, $KEYUP, [UIntPtr]::Zero) }
function Down([byte]$vk) { [Kb2]::keybd_event($vk, 0, 0, [UIntPtr]::Zero) }
function Up([byte]$vk) { [Kb2]::keybd_event($vk, 0, $KEYUP, [UIntPtr]::Zero) }

switch ($combo) {
  'circle' { Down 0x11; Down 0x10; Start-Sleep -Milliseconds 40; Tap 0x43; Start-Sleep -Milliseconds 40; Up 0x10; Up 0x11 }  # Ctrl+Shift+C
  'circle3' { Down 0x11; Down 0x10; Start-Sleep -Milliseconds 30; Tap 0x43; Start-Sleep -Milliseconds 150; Tap 0x43; Start-Sleep -Milliseconds 150; Tap 0x43; Start-Sleep -Milliseconds 30; Up 0x10; Up 0x11 }  # 3 rapid fires (key-repeat simulation)
  'gemini' { Down 0x12; Start-Sleep -Milliseconds 40; Tap 0x20; Start-Sleep -Milliseconds 40; Up 0x12 }                     # Alt+Space
  'esc'    { Tap 0x1B }                                                                                                      # Esc
  'winh'   { Down 0x5B; Start-Sleep -Milliseconds 40; Tap 0x48; Start-Sleep -Milliseconds 40; Up 0x5B }                      # Win+H
}
