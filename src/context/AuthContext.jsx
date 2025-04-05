import React, { createContext, useContext, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  loginWithEmailPassword, 
  registerWithEmailPassword, 
  logoutUser, 
  getUserData,
  subscribeToAuthChanges,
  updateUserProfile,
  createTestUser
} from '@/services/authService';
import useLocalStorage from '@/hooks/useLocalStorage';
import { showSuccessToast, showErrorToast } from '@/services/toastService';
import { debugFirebase } from '@/utils/debugFirebase';
import axios from 'axios';

// Create the context
const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const { saveUser, getUser } = useLocalStorage();

  // Subscribe to auth changes
  useEffect(() => {
    const unsubscribe = subscribeToAuthChanges(async (firebaseUser) => {
      if (firebaseUser) {
        try {
          const userData = await getUserData(firebaseUser);
          setUser(userData);
          setIsAuthenticated(true);
        } catch (err) {
          console.error('Error getting user data:', err);
          setError(err.message);
        }
      } else {
        setUser(null);
        setIsAuthenticated(false);
      }
      setLoading(false);
    });

    // Try to load user from localStorage first as a fallback
    const storedUser = getUser();
    if (storedUser) {
      setUser(storedUser);
    }

    // For development, create a test user automatically if in development mode
    if (process.env.NODE_ENV === 'development') {
      // Uncomment the next line to create test user on startup
      // createTestUser();
    }
    
    // Debugging - can be removed in production
    if (process.env.NODE_ENV === 'development') {
      window.debugFirebase = debugFirebase;
    }

    return () => unsubscribe();
  }, []);

  // Register with Firebase and MongoDB
  const register = async (name, email, password) => {
    try {
      setLoading(true);
      setError(null);

      // 1. Register with Firebase
      const firebaseUser = await registerWithEmailPassword(name, email, password);
      
      // 2. Register with MongoDB
      const mongoResponse = await axios.post(`http://localhost:7070/api/auth/register`, {
        name,
        email,
        password
      });

      // 3. Update Firebase user with MongoDB ID
      if (mongoResponse.data && mongoResponse.data._id) {
        await updateUserProfile(firebaseUser.id, {
          mongoId: mongoResponse.data._id
        });
      }

      showSuccessToast('Registration successful!');
      navigate('/login');
      return true;
    } catch (error) {
      console.error('Registration error:', error);
      setError(error.message || 'Registration failed');
      showErrorToast(error.message || 'Registration failed');
      throw error;
    } finally {
      setLoading(false);
    }
  };

  // Login
  const login = async (email, password) => {
    try {
      // First verify credentials with MongoDB
      const response = await axios.post(`${"http://localhost:5005"}/api/auth/login`, {
        email,
        password
      });
      
      const { user: mongoUser, token } = response.data;
      
      // If MongoDB login is successful, proceed with Firebase authentication
      const credentials = await loginWithEmailPassword(email, password);
      const user = credentials.user;
      
      // Update Firebase user's profile with MongoDB user data
      await updateUserProfile(user.id, {
        displayName: mongoUser.name,
        photoURL: mongoUser.avatar || null
      });
      
      // Store MongoDB user ID in Firebase user's metadata
      // await updateCurrentUserProfile(mongoUser._id); // This function does not exist in your code, you might need to implement it or use a different approach
      setUser({
        id: user.uid,
        email: user.email,
        name: user.displayName,
        avatar: user.photoURL,
        mongoId: mongoUser._id
      });
      
      setIsAuthenticated(true);
      setLoading(false);
      
      return true;
    } catch (error) {
      console.error('Login error:', error);
      setError(error.message);
      showErrorToast(error.message);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  // Logout
  const logout = async () => {
    try {
      setLoading(true);
      setError(null);
      
      await logoutUser();
      setUser(null);
      setIsAuthenticated(false);
      showSuccessToast('Logout successful!');
      navigate('/login');
      return true;
    } catch (error) {
      console.error('Logout error:', error);
      setError(error.message);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  // Update user function
  const updateUser = async (updatedUserData) => {
    if (!user) return false;
    
    try {
      await updateUserProfile(user.id, updatedUserData);
      const updatedUser = {...user, ...updatedUserData};
      setUser(updatedUser);
      saveUser(updatedUser);
      
      showSuccessToast(
        "Profile updated",
        "Your profile has been successfully updated"
      );
      
      return true;
    } catch (error) {
      showErrorToast(
        "Update failed",
        error.message || "Could not update profile"
      );
      return false;
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        error,
        isAuthenticated,
        register,
        login,
        logout,
        updateUser
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};