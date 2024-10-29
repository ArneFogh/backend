import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL;

export const fetchUserPosts = async () => {
  try {
    const response = await axios.get(`${API_URL}/api/user-posts`);
    return response.data;
  } catch (error) {
    console.error('Error fetching user posts:', error);
    throw new Error('Failed to fetch user posts');
  }
};

export const createUserPost = async (postData) => {
  try {
    const formData = new FormData();
    
    // Add basic fields
    formData.append('title', postData.title);
    formData.append('description', postData.description);
    formData.append('price', postData.price);
    formData.append('contactInfo', JSON.stringify(postData.contactInfo));

    // Add images
    postData.images.forEach((image, index) => {
      formData.append('images', image.file);
    });

    const response = await axios.post(`${API_URL}/api/user-posts`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    
    return response.data;
  } catch (error) {
    console.error('Error creating user post:', error);
    throw new Error('Failed to create user post');
  }
};

export const fetchUserPostsByUserId = async (userId) => {
  try {
    const response = await axios.get(`${API_URL}/api/user-posts/user/${userId}`);
    return response.data;
  } catch (error) {
    console.error('Error fetching user posts:', error);
    throw new Error('Failed to fetch user posts');
  }
};

export const deleteUserPost = async (postId) => {
  try {
    await axios.delete(`${API_URL}/api/user-posts/${postId}`);
  } catch (error) {
    console.error('Error deleting user post:', error);
    throw new Error('Failed to delete user post');
  }
};