import bpy, os, sys
addon = os.path.join(os.path.dirname(__file__), "mcp", "addon.py")
print("INSTALLING", addon)
bpy.ops.preferences.addon_install(filepath=addon, overwrite=True)
ok = False
for mod in ("addon",):
    try:
        bpy.ops.preferences.addon_enable(module=mod)
        ok = True
        print("ENABLED OK ->", mod)
        break
    except Exception as e:
        print("ENABLE FAIL", mod, ":", repr(e))
bpy.ops.wm.save_userpref()
print("PREFS SAVED")
print("MCP ADDONS:", [a.module for a in bpy.context.preferences.addons if a.module == "addon"])
print("RESULT", "OK" if ok else "FAILED")
