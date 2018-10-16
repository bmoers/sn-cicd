const startUsage = process.cpuUsage();
// { user: 38579, system: 6986 }

// spin the CPU for 500 milliseconds
const now = Date.now();
while (Date.now() - now < 5000);

console.log(1, startUsage);
console.log(2, process.cpuUsage());
console.log(3, process.cpuUsage(startUsage));
console.log(4, process.cpuUsage());
// { user: 514883, system: 11226 }