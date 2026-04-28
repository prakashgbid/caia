import { useEffect } from 'react';
import { useDispatch } from 'react-redux';
import { onAuthStateChanged } from './localAuth';
import { setUser } from './authSlice';

const AuthListener = ({ children }: { children: React.ReactNode }) => {
  const dispatch = useDispatch();

  useEffect(() => {
    // Set up auth state listener
    const unsubscribe = onAuthStateChanged((user) => {
      dispatch(setUser(user));
    });

    // Cleanup function
    return () => unsubscribe();
  }, [dispatch]);

  return <>{children}</>;
};

export default AuthListener; 