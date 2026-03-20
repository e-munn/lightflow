# === LightFlow v2 - Hot Reload (v2) ===
#
# Run ONCE in Textport:
#   exec(open('/Users/elijah/code/lightflow/v2/td_hotreload.py').read())
#
# Then Claude edits v2/td_cmd.py and TD auto-executes on save.

import os

p = op('/project1')
CMD_FILE = '/Users/elijah/code/lightflow/v2/td_cmd.py'

# Clean up previous
for name in ['_watcher_code', '_watcher', '_hot_exec', '_hot_timer']:
    n = op('/project1/' + name)
    if n is not None:
        n.destroy()

# Ensure cmd file exists
if not os.path.exists(CMD_FILE):
    with open(CMD_FILE, 'w') as f:
        f.write('print("td_cmd ready")\n')

# ── Approach: Script CHOP with timeslice forced on ──
watcher_code = p.create(textDAT, '_watcher_code')
watcher_code.text = """import os

CMD = '""" + CMD_FILE + """'
LAST = [0]

def cook(scriptOp):
    scriptOp.clear()
    scriptOp.numSamples = 1
    c = scriptOp.appendChan('frame')
    c[0] = absTime.frame

    try:
        mt = os.path.getmtime(CMD)
        if mt != LAST[0]:
            LAST[0] = mt
            with open(CMD) as f:
                code = f.read()
            if code.strip():
                try:
                    exec(code)
                    print("[hot] executed td_cmd.py")
                except Exception as e:
                    print("[hot] ERROR:", e)
    except FileNotFoundError:
        pass
"""
watcher_code.nodeX, watcher_code.nodeY = -800, -800

watcher = p.create(scriptCHOP, '_watcher')

# Try to set callback DAT reference
for pn in ['callbacks', 'callbackdat', 'dat']:
    try:
        setattr(watcher.par, pn, '_watcher_code')
        break
    except:
        continue

# CRITICAL: force cook every frame
try:
    watcher.par.timeslice = 1
except:
    pass
try:
    watcher.par.cooktype = 2  # "Always" cook
except:
    pass

watcher.nodeX, watcher.nodeY = -400, -800

# Test: check if watcher is actually running
print("")
print("=== HOT RELOAD v2 ===")
print("Watching: " + CMD_FILE)
print("Watcher chans: " + str(watcher.numChans))
print("Watcher samples: " + str(watcher.numSamples))
if watcher.numChans > 0:
    print("OK - watcher is cooking!")
else:
    print("WARNING - watcher may not be cooking. Trying CHOP Execute fallback...")
    # Fallback: CHOP Execute DAT on /local/time
    try:
        exe = p.create(chopexecuteDAT, '_hot_exec')
        exe.par.chop = '/local/time'
        try:
            exe.par.valuechange = True
        except:
            try:
                exe.par.onvaluechange = True
            except:
                pass
        exe.text = """import os
CMD = '""" + CMD_FILE + """'
LAST = [0]

def onValueChange(channel, sampleIndex, val, prev):
    try:
        mt = os.path.getmtime(CMD)
        if mt != LAST[0]:
            LAST[0] = mt
            with open(CMD) as f:
                code = f.read()
            if code.strip():
                exec(code)
                print("[hot] executed td_cmd.py")
    except Exception as e:
        print("[hot] err:", e)
"""
        exe.nodeX, exe.nodeY = -600, -800
        print("Fallback CHOP Execute created")
    except Exception as e:
        print("Fallback failed:", e)

print("")
print("Edit td_cmd.py and save - TD runs it automatically!")
print("")
