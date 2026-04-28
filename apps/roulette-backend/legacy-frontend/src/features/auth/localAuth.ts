// Local authentication service using localStorage

export interface User {
  uid: string;
  email: string;
  displayName?: string;
}

interface StoredUser {
  email: string;
  password: string;
  uid: string;
  displayName?: string;
}

// Helper to generate a unique ID
const generateUID = (): string => {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
};

// Get users from localStorage
const getUsers = (): Record<string, StoredUser> => {
  const users = localStorage.getItem('users');
  return users ? JSON.parse(users) : {};
};

// Save users to localStorage
const saveUsers = (users: Record<string, StoredUser>): void => {
  localStorage.setItem('users', JSON.stringify(users));
};

// Save current user to localStorage
const saveCurrentUser = (user: User | null): void => {
  if (user) {
    localStorage.setItem('currentUser', JSON.stringify(user));
  } else {
    localStorage.removeItem('currentUser');
  }
};

// Get current user from localStorage
const getCurrentUser = (): User | null => {
  const user = localStorage.getItem('currentUser');
  return user ? JSON.parse(user) : null;
};

// Register a new user
export const createUserWithEmailAndPassword = async (
  email: string,
  password: string
): Promise<{ user: User }> => {
  const users = getUsers();

  // Check if user already exists
  if (users[email]) {
    throw new Error('Email already in use');
  }

  // Create new user
  const uid = generateUID();
  const newUser: StoredUser = {
    email,
    password,
    uid
  };

  // Save user
  users[email] = newUser;
  saveUsers(users);

  // Return user object (without password)
  const userResponse: User = {
    uid,
    email
  };

  // Save as current user
  saveCurrentUser(userResponse);

  return { user: userResponse };
};

// Sign in a user
export const signInWithEmailAndPassword = async (
  email: string,
  password: string
): Promise<{ user: User }> => {
  const users = getUsers();
  const storedUser = users[email];

  // Check if user exists and password matches
  if (!storedUser) {
    throw new Error('User not found');
  }

  if (storedUser.password !== password) {
    throw new Error('Invalid password');
  }

  // Return user object (without password)
  const userResponse: User = {
    uid: storedUser.uid,
    email: storedUser.email,
    displayName: storedUser.displayName
  };

  // Save as current user
  saveCurrentUser(userResponse);

  return { user: userResponse };
};

// Sign out
export const signOut = async (): Promise<void> => {
  saveCurrentUser(null);
};

// Initialize auth state change listener
export const onAuthStateChanged = (callback: (user: User | null) => void) => {
  // Initial call with current state
  callback(getCurrentUser());

  // Set up storage event listener for cross-tab synchronization
  const handleStorageChange = (event: StorageEvent) => {
    if (event.key === 'currentUser') {
      const user = event.newValue ? JSON.parse(event.newValue) : null;
      callback(user);
    }
  };

  window.addEventListener('storage', handleStorageChange);

  // Return a function to remove the listener
  return () => {
    window.removeEventListener('storage', handleStorageChange);
  };
}; 