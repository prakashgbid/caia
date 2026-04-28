import { configureStore } from '@reduxjs/toolkit';
import rouletteReducer from '../features/roulette/rouletteSlice';
import authReducer from '../features/auth/authSlice';

export const store = configureStore({
  reducer: {
    roulette: rouletteReducer,
    auth: authReducer
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch; 