import React, { useState, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { 
  Box, 
  TextField, 
  Button, 
  Typography, 
  Container, 
  Paper, 
  Alert, 
  Link, 
  styled
} from '@mui/material';
import { loginUser, clearError } from './authSlice';
import { RootState } from '../../app/store';

const FormContainer = styled(Paper)(({ theme }) => ({
  padding: theme.spacing(4),
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  borderRadius: theme.shape.borderRadius,
  maxWidth: '450px',
  margin: '0 auto',
  marginTop: theme.spacing(8),
  backgroundColor: theme.palette.background.paper,
  boxShadow: theme.shadows[3],
}));

const StyledForm = styled('form')(({ theme }) => ({
  width: '100%',
  marginTop: theme.spacing(2),
}));

const SubmitButton = styled(Button)(({ theme }) => ({
  margin: theme.spacing(3, 0, 2),
}));

const Login: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formErrors, setFormErrors] = useState<{email?: string, password?: string}>({});
  
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { user, status, error } = useSelector((state: RootState) => state.auth);
  
  useEffect(() => {
    // If user is already logged in, redirect to main page
    if (user) {
      navigate('/');
    }
    
    // Clear any previous errors when component mounts
    dispatch(clearError());
  }, [user, navigate, dispatch]);
  
  const validateForm = (): boolean => {
    const errors: {email?: string, password?: string} = {};
    let isValid = true;
    
    if (!email) {
      errors.email = 'Email is required';
      isValid = false;
    } else if (!/\S+@\S+\.\S+/.test(email)) {
      errors.email = 'Email is invalid';
      isValid = false;
    }
    
    if (!password) {
      errors.password = 'Password is required';
      isValid = false;
    } else if (password.length < 6) {
      errors.password = 'Password must be at least 6 characters';
      isValid = false;
    }
    
    setFormErrors(errors);
    return isValid;
  };
  
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    
    if (validateForm()) {
      // @ts-ignore (dispatch is properly typed but TypeScript has issues with thunks)
      dispatch(loginUser({ email, password }));
    }
  };
  
  return (
    <Container component="main" maxWidth="sm">
      <FormContainer>
        <Typography component="h1" variant="h5">
          Sign In
        </Typography>
        
        {error && (
          <Alert severity="error" sx={{ mt: 2, width: '100%' }}>
            {error}
          </Alert>
        )}
        
        <StyledForm onSubmit={handleSubmit} noValidate>
          <TextField
            variant="outlined"
            margin="normal"
            required
            fullWidth
            id="email"
            label="Email Address"
            name="email"
            autoComplete="email"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={!!formErrors.email}
            helperText={formErrors.email}
            disabled={status === 'loading'}
          />
          
          <TextField
            variant="outlined"
            margin="normal"
            required
            fullWidth
            name="password"
            label="Password"
            type="password"
            id="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={!!formErrors.password}
            helperText={formErrors.password}
            disabled={status === 'loading'}
          />
          
          <SubmitButton
            type="submit"
            fullWidth
            variant="contained"
            color="primary"
            disabled={status === 'loading'}
          >
            {status === 'loading' ? 'Signing In...' : 'Sign In'}
          </SubmitButton>
          
          <Box mt={2} textAlign="center">
            <Typography variant="body2">
              Don't have an account?{' '}
              <Link onClick={() => navigate('/register')} style={{ cursor: 'pointer' }}>
                Sign Up
              </Link>
            </Typography>
          </Box>
        </StyledForm>
      </FormContainer>
    </Container>
  );
};

export default Login; 