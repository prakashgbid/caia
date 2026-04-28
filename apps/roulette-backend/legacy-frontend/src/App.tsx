/**
 * @file App.tsx
 * @description Main application component that handles routing and overall layout
 * 
 * This component serves as the entry point for the Roulette Advisor application.
 * It provides:
 * - Application-wide theming (dark theme optimized for casino experience)
 * - Navigation header with authentication controls
 * - Routing configuration with protected routes
 * - Main layout structure with responsive container
 * - Footer with copyright information
 */

import React from 'react';
import { useSelector } from 'react-redux';
import { Container, CssBaseline, Box, AppBar, Toolbar, Typography, ThemeProvider, createTheme, Button } from '@mui/material';
import { Routes, Route, useNavigate } from 'react-router-dom';
import RouletteBoard from './features/roulette/RouletteBoard';
import RouletteControls from './features/roulette/RouletteControls';
import Login from './features/auth/Login';
import Register from './features/auth/Register';
import ProtectedRoute from './features/auth/ProtectedRoute';
import { RootState } from './app/store';
import { useDispatch } from 'react-redux';
import { logoutUser } from './features/auth/authSlice';

/**
 * Custom dark theme configuration for the application
 * 
 * Creates a dark theme that resembles the ambiance of a casino environment:
 * - Dark background to enhance focus on the roulette table
 * - Primary color (blue) for main actions and highlights
 * - Secondary color (pink) for calls-to-action and important elements
 * - Custom paper and background colors for improved contrast
 */
const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#3f51b5',
    },
    secondary: {
      main: '#f50057',
    },
    background: {
      default: '#121212',
      paper: '#1e1e1e',
    },
  },
});

/**
 * Main App component
 * 
 * Handles:
 * - Authentication state management
 * - Navigation between routes
 * - Layout structure with header, content area, and footer
 * - Protected route handling for authenticated users
 * 
 * @returns {JSX.Element} The rendered application
 */
function App() {
  // Get current authentication state from Redux store
  const { user } = useSelector((state: RootState) => state.auth);
  const dispatch = useDispatch();
  const navigate = useNavigate();

  /**
   * Handles user logout
   * Dispatches the logout action to the Redux store
   */
  const handleLogout = () => {
    // @ts-ignore (dispatch is properly typed but TypeScript has issues with thunks)
    dispatch(logoutUser());
  };

  return (
    <ThemeProvider theme={darkTheme}>
      {/* Reset CSS baseline for consistent rendering */}
      <CssBaseline />
      <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        {/* Application header with authentication controls */}
        <AppBar position="static">
          <Toolbar>
            <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
              Roulette Advisor
            </Typography>
            {/* Conditional rendering based on authentication state */}
            {user ? (
              <Button color="inherit" onClick={handleLogout}>
                Logout
              </Button>
            ) : (
              <Button color="inherit" onClick={() => navigate('/login')}>
                Login
              </Button>
            )}
          </Toolbar>
        </AppBar>
        
        {/* Main content area with routes */}
        <Container component="main" sx={{ mt: 4, mb: 4, flexGrow: 1 }}>
          <Routes>
            {/* Public routes accessible to all users */}
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            
            {/* Protected routes that require authentication */}
            <Route path="/" element={
              <ProtectedRoute>
                <>
                  {/* Main game components */}
                  <RouletteBoard />
                  <RouletteControls />
                </>
              </ProtectedRoute>
            } />
          </Routes>
        </Container>
        
        {/* Application footer */}
        <Box component="footer" sx={{ py: 3, px: 2, mt: 'auto', backgroundColor: 'background.paper' }}>
          <Container maxWidth="sm">
            <Typography variant="body2" color="text.secondary" align="center">
              Roulette Advisor Game - {new Date().getFullYear()}
            </Typography>
          </Container>
        </Box>
      </Box>
    </ThemeProvider>
  );
}

export default App;
