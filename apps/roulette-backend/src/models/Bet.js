const mongoose = require('mongoose');

const betSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Bet must belong to a user']
  },
  type: {
    type: String,
    required: [true, 'Bet type is required'],
    enum: [
      'straight', 
      'split', 
      'street', 
      'corner', 
      'five', 
      'line', 
      'dozen', 
      'column', 
      'red', 
      'black', 
      'odd', 
      'even', 
      'low', 
      'high'
    ]
  },
  numbers: {
    type: [Number],
    required: [true, 'Bet numbers are required'],
    validate: {
      validator: function(numbers) {
        return numbers.length > 0 && numbers.every(num => num >= 0 && num <= 36);
      },
      message: 'Bet numbers must be between 0 and 36'
    }
  },
  amount: {
    type: Number,
    required: [true, 'Bet amount is required'],
    min: [1, 'Bet amount must be at least 1']
  },
  winningNumber: {
    type: Number,
    min: 0,
    max: 36
  },
  payout: {
    type: Number,
    default: 0
  },
  playId: {
    type: String,
    required: [true, 'Play ID is required']
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Add index for faster queries by user and date
betSchema.index({ user: 1, createdAt: -1 });
betSchema.index({ playId: 1 });

// Virtual for calculating if the bet was a win
betSchema.virtual('isWin').get(function() {
  if (this.winningNumber === undefined) return false;
  return this.numbers.includes(this.winningNumber);
});

const Bet = mongoose.model('Bet', betSchema);

module.exports = Bet; 