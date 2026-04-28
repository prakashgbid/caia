import axios from 'axios';

// Create axios instance with base URL and default headers
const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL || 'http://localhost:5000/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add a request interceptor to include the auth token in headers
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Add a response interceptor to handle auth errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      // Clear local storage and redirect to login page
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Auth API
export const authAPI = {
  register: async (userData: { username: string; email: string; password: string }) => {
    const response = await api.post('/auth/register', userData);
    return response.data;
  },
  
  login: async (credentials: { email: string; password: string }) => {
    const response = await api.post('/auth/login', credentials);
    // Save token and user to local storage
    localStorage.setItem('token', response.data.token);
    localStorage.setItem('user', JSON.stringify(response.data.data.user));
    return response.data;
  },
  
  logout: async () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    return { success: true };
  },
  
  getProfile: async () => {
    const response = await api.get('/auth/me');
    return response.data;
  },
  
  updateProfile: async (userData: { username?: string; email?: string }) => {
    const response = await api.patch('/auth/update-profile', userData);
    return response.data;
  },
  
  updatePassword: async (passwordData: { currentPassword: string; newPassword: string }) => {
    const response = await api.patch('/auth/update-password', passwordData);
    return response.data;
  }
};

// Game API
export const gameAPI = {
  startGame: async () => {
    const response = await api.post('/game/start');
    return response.data;
  },
  
  endGame: async (gameId: string) => {
    const response = await api.patch(`/game/${gameId}/end`);
    return response.data;
  },
  
  abandonGame: async (gameId: string) => {
    const response = await api.patch(`/game/${gameId}/abandon`);
    return response.data;
  },
  
  getGameHistory: async (params: { page?: number; limit?: number; status?: string } = {}) => {
    const response = await api.get('/game', { params });
    return response.data;
  },
  
  getGameDetails: async (gameId: string) => {
    const response = await api.get(`/game/${gameId}`);
    return response.data;
  }
};

// Bet API
export const betAPI = {
  createBets: async (data: { 
    bets: Array<{
      type: string;
      numbers: number[];
      amount: number;
    }>;
    gameId?: string;
    winningNumber: number;
  }) => {
    const response = await api.post('/bets', data);
    return response.data;
  },
  
  getBetHistory: async (params: { page?: number; limit?: number; gameId?: string } = {}) => {
    const response = await api.get('/bets', { params });
    return response.data;
  },
  
  getBetStats: async (params: { gameId?: string } = {}) => {
    const response = await api.get('/bets/stats', { params });
    return response.data;
  }
};

export default api; 