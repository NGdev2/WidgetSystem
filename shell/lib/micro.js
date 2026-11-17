// Daily micro line: real data (day of year, Unix day) + an "on this day in computing" fact,
// or a classic programmer saying on days without one. Shared by every widget via ctx.ui.micro().
const HISTORY = {
  '01-01': [1970, 'UNIX EPOCH STARTS'], '01-15': [2001, 'WIKIPEDIA LAUNCHED'], '01-19': [2038, '32-BIT UNIX TIME ENDS'],
  '01-24': [1984, 'MACINTOSH RELEASED'], '02-15': [1946, 'ENIAC DEDICATED'], '02-20': [1991, 'PYTHON 0.9.0 RELEASED'],
  '03-12': [1989, 'THE WEB IS PROPOSED'], '03-15': [1985, 'FIRST .COM REGISTERED'], '04-01': [1976, 'APPLE FOUNDED'],
  '04-04': [1975, 'MICROSOFT FOUNDED'], '04-07': [2005, "GIT'S FIRST COMMIT"], '04-10': [2008, 'GITHUB LAUNCHES'],
  '04-30': [1993, 'THE WEB GOES PUBLIC DOMAIN'], '05-11': [1997, 'DEEP BLUE BEATS KASPAROV'], '05-23': [1995, 'JAVA ANNOUNCED'],
  '06-23': [1912, 'ALAN TURING BORN'], '07-20': [1969, 'APOLLO 11 LANDS'], '08-06': [1991, 'FIRST WEBSITE ONLINE'],
  '08-12': [1981, 'IBM PC INTRODUCED'], '08-24': [1995, 'WINDOWS 95 RELEASED'], '08-25': [1991, 'LINUX ANNOUNCED'],
  '09-04': [1998, 'GOOGLE FOUNDED'], '09-09': [1947, 'FIRST BUG FOUND: A MOTH'], '09-17': [1991, 'LINUX 0.01 RELEASED'],
  '09-27': [1983, 'GNU ANNOUNCED'], '10-29': [1969, 'ARPANET SENDS "LO"'], '11-02': [1988, 'MORRIS WORM SPREADS'],
  '11-17': [1970, 'MOUSE PATENT GRANTED'], '11-20': [1985, 'WINDOWS 1.0 RELEASED'], '12-09': [1968, 'MOTHER OF ALL DEMOS'],
  '12-10': [1815, 'ADA LOVELACE BORN'],
};
const SAYINGS = ['THERE IS NO PLACE LIKE 127.0.0.1', 'THE ANSWER IS 42', 'HELLO, WORLD', 'IT WORKS ON MY MACHINE',
  'EXIT 0 IS THE GOAL', 'COMMIT EARLY, COMMIT OFTEN', 'HAVE YOU TRIED TURNING IT OFF AND ON?', 'SUDO MAKE ME A SANDWICH',
  '/DEV/NULL HEARS ALL COMPLAINTS', 'ADA · TURING · HOPPER', 'CTRL+S, THEN CTRL+S AGAIN', '0x2A == 42'];

const utcDay = (key) => { const [y, m, d] = key.split('-').map(Number); return Date.UTC(y, m - 1, d) / 86400000; };
export const unixDay = (key) => utcDay(key);                                   // days since 1970-01-01
export const dayOfYear = (key) => utcDay(key) - utcDay(key.slice(0, 4) + '-01-01') + 1;

/** micro('2026-11-17') -> {text: "DAY 321 // 1970: MOUSE PATENT GRANTED", title: "Day 321 of the year · …"} */
export function micro(dateKey = localDateKey()) {
  const doy = dayOfYear(dateKey);
  const event = doy === 256 ? ['', "PROGRAMMERS' DAY"] : HISTORY[dateKey.slice(5)];
  const fact = event ? (event[0] ? `${event[0]}: ${event[1]}` : event[1]) : SAYINGS[unixDay(dateKey) % SAYINGS.length];
  return { text: `DAY ${doy} // ${fact}`, title: `Day ${doy} of the year · Unix day ${unixDay(dateKey)}${event ? ' · on this day in computing' : ''}` };
}

export function localDateKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
