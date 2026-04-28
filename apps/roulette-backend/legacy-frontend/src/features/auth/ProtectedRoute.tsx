import React, { useEffect } from 'react';
import { useSelector } from 'react-redux';
import { Navigate, useLocation } from 'react-router-dom';
import { RootState } from '../../app/store';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const { user, status } = useSelector((state: RootState) => state.auth);
  const location = useLocation();

  // If we're still loading, don't decide yet
  if (status === 'loading') {
    return <div>Loading...</div>;
  }

  // If the user is not authenticated, redirect to login
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // If user is authenticated, render the protected component
  return <>{children}</>;
};

export default ProtectedRoute; 