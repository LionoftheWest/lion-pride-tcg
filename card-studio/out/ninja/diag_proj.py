import bpy, sys, os, json
import numpy as np
ND = sys.argv[sys.argv.index("--")+1]
bpy.ops.wm.open_mainfile(filepath=os.path.join(ND,"character_stage2.blend"))
hp = bpy.data.objects["source_highpoly"]
me = hp.data
info = json.load(open(os.path.join(ND,"parts_info.json")))
IW,IH = info["image"]; cx0,cy0,cx1,cy1 = info["char_bbox"]
TARGET_H=1.809; mpp = TARGET_H/(cy1-cy0); ccx=(cx0+cx1)/2.0
n=len(me.vertices)
co=np.empty(n*3); me.vertices.foreach_get("co",co); co=co.reshape(n,3)
mw=np.array(hp.matrix_world.to_4x4()); world=co@mw[:3,:3].T+mw[:3,3]
px = world[:,0]/mpp + ccx
py = cy1 - world[:,2]/mpp
print("char_bbox x: %d..%d   y: %d..%d" % (cx0,cx1,cy0,cy1))
print("projected px: %.0f..%.0f   py: %.0f..%.0f" % (px.min(),px.max(),py.min(),py.max()))
print("world x: %.3f..%.3f  z: %.3f..%.3f" % (world[:,0].min(),world[:,0].max(),world[:,2].min(),world[:,2].max()))
# how much of the character matte does the projection actually land on?
img=bpy.data.images.load(os.path.join(ND,"g_poncho_mask.png"))
w,h=img.size; buf=np.empty(w*h*4,dtype=np.float32); img.pixels.foreach_get(buf)
m=buf.reshape(h,w,4)[::-1,:,0]>0.5
ys,xs=np.where(m)
print("poncho MASK px: %d..%d  py: %d..%d" % (xs.min(),xs.max(),ys.min(),ys.max()))
