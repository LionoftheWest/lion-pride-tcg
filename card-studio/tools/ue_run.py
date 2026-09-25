"""Run Python inside a LIVE Unreal Engine editor from the command line.

Uses Unreal's built-in Remote Execution protocol (no MCP, no reconnect needed).
Prerequisite (one time per project): enable the Python Editor Script Plugin and
Remote Execution, then keep the editor running.

Usage:
    python ue_run.py -c "import unreal; print(unreal.SystemLibrary.get_engine_version())"
    python ue_run.py path/to/script.py
"""
import sys, time

UE_REMOTE = r"C:\Program Files\Epic Games\UE_5.8\Engine\Plugins\Experimental\PythonScriptPlugin\Content\Python"
sys.path.append(UE_REMOTE)
import remote_execution as r  # noqa: E402


def run(code, timeout=30.0):
    conn = r.RemoteExecution()
    conn.start()
    node = None
    deadline = time.time() + timeout
    while time.time() < deadline:
        time.sleep(1.0)
        ns = conn.remote_nodes
        if ns:
            node = ns[0]
            break
    if not node:
        print("ERROR: no running Unreal editor found (is Remote Execution enabled?)")
        conn.stop()
        return 1
    conn.open_command_connection(node["node_id"])
    out = conn.run_command(code, exec_mode="ExecuteFile", unattended=True)
    for e in out.get("output", []):
        print(e.get("output", "").rstrip())
    ok = out.get("success")
    if not ok:
        print("FAILED:", out.get("result"))
    conn.close_command_connection()
    conn.stop()
    return 0 if ok else 2


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "-c":
        sys.exit(run(sys.argv[2]))
    elif len(sys.argv) == 2:
        sys.exit(run(open(sys.argv[1]).read()))
    else:
        print(__doc__)
        sys.exit(1)
