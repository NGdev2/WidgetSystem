// fsck speaks in log lines. Each group is a shuffle bag: no line repeats until the bag is empty.
export const LINES = {
  boot: ['[ OK ] Started fsck.service.', 'Mount count reached. Scheduled check.', 'Who woke me? Oh. inotify. Of course.', '$ fsck -y /dev/desk'],
  patrol: ['/dev/desk: clean.', 'Walking the free list.', 'Superblock\'s fine. You look tired.', 'Everything\'s fine. Suspiciously fine.', '{name}: clean.', '{name}: 0 errors.'],
  proud: ['I run before your desktop even mounts.', 'I don\'t break things. I make them exit 0.', 'Scheduled by cron. Trusted by root. Well, in spirit.', 'Every boot, I\'m first in.'],
  grumpy: ['Who tore the panel? …I know who tore the panel.', 'Third hole today. Filing a ticket. Against you.', 'You break, I fix. Some of us have jobs.', 'man 8 fsck. It\'s short. Unlike my patience.'],
  sad: ['0 errors. Again. Am I even needed?', 'A repair daemon with nothing to repair is just… a process.', 'Nobody defragments anymore.', 'exit 0… exit 0… exit 0…'],
  sleepy: ['sleep 900', 'Next run in {next}. Don\'t break anything.', 'SIGSTOP… zz'],
  working: ['Patching… 40%… 60%…', 'Hold still, panel.', 'Industrial-grade tape.', 'Relinking orphaned pixels.'],
  done: ['EXIT 0.', 'Fixed. Logged. You\'re welcome.', '[ OK ] /dev/sheet0 repaired.'],
  occupied: ['Occupied. I\'ll wait.', 'Out of the hole, please.', 'After you.'],
  interrupted: ['Unhand me, I\'m mid-transaction!', 'I was at 87%!', 'Replaying journal… resuming.', 'I\'m in D state. Uninterruptible. Mostly.'],
  thrown: ['Segmentation fault!', 'Core dumped. Rebooting.', 'Unplanned unmount.'],
  click: ['Not in my job description.', 'Positive feedback logged.', 'I\'m working. Technically.', 'Pong.'],
  spam: ['429. Too many requests.'],
  crack: ['Screen glass, again. Who\'s fighting on my desktop?', 'Sealing crack. Glass is not a feature.'],
  orphan: ['Orphan found: {label}. Moving to lost+found.', 'Relinking {label} to lost+found.'],
  error: ['{label}', 'A widget crashed. I have a wrench and opinions.'],
  declined: ['Restart declined. Logged.', 'Fine. It stays broken. Logged.'],
  restarted: ['Restarted. EXIT 0.', 'Back up. Nobody saw anything.'],
  cpuHot: ['Load average {load}. Who forked?', 'CPU at {cpu}%. Fanning the hot one.'],
  heat: ['{temp}°C. I\'m sweating, and I don\'t even have pores.'],
  memFull: ['Memory at {mem}%. Swapping, don\'t look.'],
  battery: ['Battery {bat}%. Power-save. I walk slower out of respect.'],
  aligned: ['{name}: aligned with {other}. ✓', 'Edges line up. Beautiful. Logged.'],
  misaligned: ['{name}: off by {px}px. Logged.', 'Off by {px}px. I\'m not saying anything. Logged.'],
  free: ['{name}: free placement. Bold.'],
  morning: ['Overnight: {errors} errors. Yesterday: {fixed} fixed. Uptime {uptime}.'],
  mochi: ['Mochi: 0 errors. As always.', 'Hello, Mochi. Don\'t chew the tape.'],
};

const bags = new Map();
export function line(group, vars = {}) {
  const all = LINES[group] || [group];
  let bag = bags.get(group);
  if (!bag || !bag.length) { bag = [...all].sort(() => Math.random() - 0.5); bags.set(group, bag); }
  return bag.pop().replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : '?'));
}
