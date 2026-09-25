# Animation Craft — a universal professional playbook

This document holds the animation understanding of a professional character animator, at the
level of a studio like Blizzard or Pixar. It is general. It applies to anything we build — a
biped, a quadruped, a bird, a serpent, an insect, a fish, a machine, a cloth, or an effect.
The stone golem is only our first example, not the frame.

Read this before you animate anything. It defines HOW a pro thinks, not which button to press.

The core idea: animation is **acting with weight and timing**. A pose alone is not enough. The
motion between poses carries the weight, the force, and the intent. We animate mass and thought.

---

## Part A — The universal foundation (true for every subject)

### 1. The mindset
- Every action has an intent. The subject wants something. The motion shows it.
- Weight is the first read. The audience must feel the mass in every frame.
- Clarity first. One clear idea per pose. The camera must read it at a glance.
- Push the motion. Real motion is subtle. Good animation exaggerates for clarity. Blizzard
  pushes hard. Pixar stays grounded. Both push past life.

### 2. The 12 principles
- **Squash and stretch.** Show force and flex. Soft things squash a lot. Rigid things squash
  a little, but still give slightly, or they look dead.
- **Anticipation.** Wind up before an action. The bigger the force, the bigger the wind‑up.
- **Staging.** Present the action clearly to the camera. Keep a clean silhouette.
- **Pose to pose versus straight ahead.** Plan key poses for a controlled action. Animate
  straight ahead for chaos — fire, water, cloth, hair.
- **Follow through and overlap.** Loose parts lag, then settle. A lead mass pulls the rest.
- **Slow in and slow out (ease).** A mass eases out of a pose, moves fast at the middle, and
  eases into the next. Sharp eases read as weight.
- **Arc.** Limbs, heads, and bodies travel in curves. A straight path looks robotic.
- **Secondary action.** A supporting motion adds life. It must not fight the main action.
- **Timing.** The frame count sets the weight and the mood. Slow reads heavy. Fast reads light.
- **Exaggeration.** Push the strongest pose beyond life so it reads.
- **Solid posing.** Keep correct volume, balance, and depth. Avoid a flat or twinned pose.
- **Appeal.** The subject is interesting to watch. A clear, strong shape has appeal. This
  applies to a villain and a monster too, not only a cute hero.

### 3. Body mechanics (the physics a pro obeys)
- **Center of gravity.** The mass balances over the base of support. Move the weight before
  you move a support limb.
- **Weight shift.** To free a limb, first shift the mass onto the others.
- **Base of support.** A wide base reads stable and heavy. A narrow base reads light or unstable.
- **Counter‑rotation.** In a stride, the shoulders and the hips twist in opposite directions.
- **Working limb versus support limb.** One limb carries the weight. Another is free to act.
- **Momentum and inertia.** A heavy mass is slow to start and slow to stop. It overshoots.
- **Effort and resistance.** Show the strain. A hard effort is slow and it shakes.

### 4. The professional workflow (blocking → spline → polish)
1. **Plan.** Gather reference. Thumbnail the key poses. Note the beats and the frame timing.
2. **Blocking.** Set the key storytelling poses on **stepped** interpolation. Judge the poses
   and the timing first, with no in‑betweens. The shot is won here.
3. **Breakdowns.** Add the breakdown poses between the keys. These define the arcs and the
   overlap. The breakdown is where the craft lives.
4. **Spline.** Switch to spline. Clean the curves in the graph editor. Fix the arcs. Favor a
   pose by adding frames near it.
5. **Polish.** Add overlap, follow‑through, and moving holds. Add secondary action and texture.
   Set the final eases and the final timing.
6. **Final.** The contact, the settle, the face, the small details. Check the silhouette.

### 5. Posing craft (a golden pose)
- **Line of action.** One clear curve runs through the whole body. It gives energy.
- **Silhouette.** Read the pose as a solid black shape. If it reads, it is strong.
- **Asymmetry.** Break symmetry. Never twin the two sides. Offset the limbs, the hips, the head.
- **Straight against curve.** Pair a straight side with a curved side. It adds tension.
- **Balance and depth.** Keep the mass balanced. Angle the pose to the camera for depth.

### 6. Timing and spacing (where weight lives)
- **Timing** is the number of frames for an action. **Spacing** is how far it moves each frame.
  Weight comes from spacing, not from poses alone.
- Close spacing reads slow. Wide spacing reads fast.
- **Ease out** of a pose. **Snap** through the middle. **Cushion** into the next pose. This is
  the shape of weight.
- **Overshoot and settle.** A part passes the target, then returns, then holds.
- **Moving hold.** A held pose still drifts a little. A frozen pose looks dead.
- **Hold and favor.** Add frames near the key pose the eye should read.

### 7. Arcs, overlap, and follow‑through
- Track the path of a hand, a foot, a head, the hips. The path must curve.
- **Overlap and drag.** Parts lag the main mass. A whip, a tail, an antenna drags behind.
- **Successive breaking of joints.** A motion travels down a chain. The base leads, the tip
  follows, in order. This is the key to a tail, a spine, a tentacle, and a whip.
- **Follow through.** A part continues past the stop, then settles.

---

## Part B — Locomotion by body plan (build and animate anything)

Weight, balance, and the principles above are constant. The footfall pattern and the spine
motion change with the body plan. Study the real subject first.

### 8. Biped (human, humanoid, ape, large monster)
- **Walk cycle** — four core poses: contact, down, passing, up. The hips shift side to side
  and up and down. The arms swing opposite the legs.
- **Run** — a flight phase with no foot on the ground. More lean, more overlap.
- Heavy bipeds move slower with a wider base. Light bipeds move fast with a narrow base.

### 9. Quadruped (dog, cat, horse, bear, lizard)
- **Gaits** — walk, trot, pace, canter, and gallop. Each has a distinct footfall pattern and
  timing. A walk is a four‑beat pattern. A gallop is fast with a suspension phase.
- The **spine flexes** and the **tail overlaps**. The front and the back move in coordination.
- Predators and prey move differently. Study the real animal.

### 10. Bird and flight
- **Flap cycle** — a strong down‑stroke for lift, a soft up‑stroke to reset. The wing bends
  and the feathers spread.
- **Glide** — small adjustments, long holds. **Takeoff and landing** — big anticipation and
  a hard settle.
- The body follows an arc through the air. The head stays stable.

### 11. Serpent and worm
- **Lateral undulation** — a sine wave travels along the body on a spline. The head leads.
- Use spline IK. The wave moves back along the chain in succession.
- A strike is a fast anticipation coil, then a snap forward, then a recoil.

### 12. Insect, spider, and many‑legged
- **Alternating tripod gait** — a spider moves three legs while three stay planted. The body
  stays stable and level.
- The legs move in fast, small, mechanical arcs. The joints are stiff and precise.
- The body can bob and the abdomen can drag with overlap.

### 13. Fish and swimming
- **Undulation** — a wave travels down the body and the tail. The fins steer and stabilize.
- Water adds drag and a floaty ease. Nothing snaps to a hard stop.

### 14. Machine and robot
- Little or no ease on a rigid joint. Mechanical parts move at a constant rate or with a
  hard start and stop.
- Hydraulics can overshoot. Servos snap. There is little squash and stretch on metal.
- Contrast a mechanical base with any organic or cloth part for life.

### 15. Cloth, soft body, and hair
- Animate straight ahead or use simulation. These parts react. They do not lead.
- They drag, overlap, and settle. They obey the main body, then follow with a delay.

---

## Part C — Beyond locomotion

### 16. Weight classes (the same subject, different mass)
- **Light and agile** — fast, snappy, big spacing, small anticipation, quick recovery.
- **Medium** — balanced timing.
- **Heavy and massive** — slow anticipation, a committed fast strike, a hard settle with a
  recoil, and a ground reaction. Do not fully straighten a joint.
- **Floaty or low gravity** — long slow arcs, gentle eases, slow settles.

### 17. Facial animation and acting
- The eyes lead the performance. The gaze moves first, then the head, then the body.
- Add eye darts and blinks. A blink often hides a change of idea.
- Use the brow, the lids, the mouth, and the jaw for emotion. Avoid a symmetric face.
- Lip sync matches the shapes of speech, not every letter. Hit the strong shapes.
- The face shows the thought. The thought drives the body.

### 18. Effects animation (attacks, magic, impacts)
- Fire, smoke, water, and magic animate straight ahead. They flow and dissipate.
- An impact needs a flash, a burst, a shockwave, and settling debris.
- Timing sells power. A fast attack needs a bright, short, sharp effect. A heavy attack needs
  a big, slow build and a large release.
- Add a secondary reaction — dust, a screen shake, a recoil on the caster.

### 19. Camera and staging
- Stage the action to the strongest angle. A three‑quarter view shows depth and the silhouette.
- The camera can add scale. A low angle makes a subject look large. A shake sells an impact.
- Keep the key action inside the frame across the whole motion.

### 20. Game animation versus film
- **Game loops** must be seamless. The first and the last frame match.
- **Idle** — a slow breathing loop. A moving hold. Never fully still.
- **Attack** — three windows: anticipation, active, and recovery. These also serve the
  player's reaction time, so keep them readable.
- **Hit and stun** — a sharp reaction, then a recovery, sold with overlap.
- **Root motion versus in place** — a loop animates in place. A traveling move uses root motion.
- Readability at a small size matters. Strong silhouettes and clear timing win.

### 21. Style — Blizzard versus Pixar versus our target
- **Blizzard cinematic.** Strong, held hero poses. Snappy timing. Big anticipation. Clear
  silhouettes. Exaggerated weight. A smear frame on a fast move.
- **Pixar naturalism.** Grounded weight. Subtle overlap. Careful eases. Deep acting and appeal.
- **Our target.** A game‑stylized middle. Push the hero poses like Blizzard. Keep the weight
  honest like Pixar. Read clearly at a small size.

---

## Part D — Worked examples (many body plans)
- **Biped heavy stomp.** Shift weight, lift the knee high and slow, coil back, then slam the
  foot down and forward fast. Compress on contact. Overshoot, settle, and shake.
- **Quadruped gallop.** Gather the legs under the body, launch through a suspension phase,
  reach the front legs, and land back to front. The spine flexes through the cycle.
- **Bird takeoff.** A deep crouch, a big down‑stroke, a push off the ground, and a climbing arc.
- **Serpent strike.** A slow S‑coil anticipation, a fast forward snap along the spline, and a
  recoil back to the coil.
- **Spider scuttle.** A fast alternating tripod, a level body, small mechanical leg arcs, and
  a slight abdomen drag.

## Part E — How we capture this in the build
- Encode the motion shapes as reusable primitives — anticipation, ease, snap, overshoot,
  follow‑through, a moving hold, and successive joint breaking. Build every action from these.
- Build a **gait template per body plan** — biped, quadruped, bird, serpent, insect, fish.
  Each defines the footfall pattern and the spine motion. A boss picks a plan.
- Use the blocking → spline → polish order in our scripts. Block the key poses first.
- Prefer mocap retargeting for realistic weight. Hand‑animate the hero accents on top.
- Add the checks in `CREATURE_PIPELINE_AUDIT.md` so a weak result is caught.

See also `ANATOMY_PIPELINE.md` for the model and rig build, and the resource list at the end
of `CREATURE_PIPELINE_AUDIT.md` for courses, creators, and mocap libraries.
