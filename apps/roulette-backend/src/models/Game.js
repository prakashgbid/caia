const mongoose = require('mongoose');

const gameSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Game must belong to a user']
  },
  history: {
    type: [Number],
    default: []
  },
  bankrollStart: {
    type: Number,
    required: [true, 'Starting bankroll is required']
  },
  bankrollEnd: {
    type: Number
  },
  startTime: {
    type: Date,
    default: Date.now
  },
  endTime: {
    type: Date
  },
  status: {
    type: String,
    enum: ['active', 'completed', 'abandoned'],
    default: 'active'
  },
  statistics: {
    hotNumbers: [Number],
    coldNumbers: [Number],
    redBlackRatio: Number,
    oddEvenRatio: Number,
    highLowRatio: Number
  }
});

// Add index for faster queries
gameSchema.index({ user: 1, startTime: -1 });
gameSchema.index({ status: 1 });

// Virtual for calculating game duration
gameSchema.virtual('duration').get(function() {
  if (!this.endTime) return null;
  return (this.endTime - this.startTime) / 1000; // Duration in seconds
});

// Virtual for calculating net profit/loss
gameSchema.virtual('profitLoss').get(function() {
  if (!this.bankrollEnd) return null;
  return this.bankrollEnd - this.bankrollStart;
});

// Method to update game statistics based on history
gameSchema.methods.updateStatistics = function() {
  if (this.history.length === 0) return;
  
  // Count number frequencies
  const numberCount = {};
  for (let i = 0; i <= 36; i++) {
    numberCount[i] = 0;
  }
  
  this.history.forEach(num => {
    numberCount[num]++;
  });
  
  // Find hot and cold numbers
  const entries = Object.entries(numberCount).map(([num, count]) => ({
    number: parseInt(num),
    count
  }));
  
  const sortedEntries = [...entries].sort((a, b) => b.count - a.count);
  this.statistics.hotNumbers = sortedEntries.slice(0, 5).map(e => e.number);
  this.statistics.coldNumbers = sortedEntries.slice(-5).map(e => e.number);
  
  // Calculate ratios
  const redNumbers = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
  let redCount = 0, blackCount = 0;
  let oddCount = 0, evenCount = 0;
  let lowCount = 0, highCount = 0;
  
  this.history.forEach(num => {
    // Skip 0
    if (num === 0) return;
    
    // Red/Black
    if (redNumbers.includes(num)) {
      redCount++;
    } else {
      blackCount++;
    }
    
    // Odd/Even
    if (num % 2 === 0) {
      evenCount++;
    } else {
      oddCount++;
    }
    
    // Low/High
    if (num <= 18) {
      lowCount++;
    } else {
      highCount++;
    }
  });
  
  this.statistics.redBlackRatio = blackCount === 0 ? 0 : redCount / blackCount;
  this.statistics.oddEvenRatio = evenCount === 0 ? 0 : oddCount / evenCount;
  this.statistics.highLowRatio = lowCount === 0 ? 0 : highCount / lowCount;
};

const Game = mongoose.model('Game', gameSchema);

module.exports = Game; 