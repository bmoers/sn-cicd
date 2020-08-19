
/**
 * Get a random number in the given range
 * 
 * @param {Number} min range min value
 * @param {Number} max range max value
 */
const getRandomInt = (min, max) => {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}
module.exports = getRandomInt;
