require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');

const app = express();
const port = 3002;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.send('Backend server is running!');
});

// GET /api/users
app.get('/api/users', async (req, res) => {
  const { data, error } = await supabase.from('users').select('id, username');
  if (error) return res.status(500).json({ error: error.message });
  res.status(200).json(data);
});

// POST /api/login
app.post('/api/login', async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Username is required' });

  let { data: user, error } = await supabase
    .from('users')
    .select('id, username')
    .eq('username', username)
    .single();

  if (error && error.code === 'PGRST116') {
    const { data: newUser, error: newUserError } = await supabase
      .from('users')
      .insert([{ username }])
      .select('id, username')
      .single();

    if (newUserError) return res.status(500).json({ error: newUserError.message });
    user = newUser;
  } else if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.status(200).json(user);
});

// GET /api/chats - ROBUST a new, more reliable implementation
app.get('/api/chats', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'User ID is required' });

  try {
    // 1. Get all chat IDs for the current user
    const { data: userChatLinks, error: chatLinksError } = await supabase
      .from('user_chats')
      .select('chat_id')
      .eq('user_id', userId);

    if (chatLinksError) throw chatLinksError;

    const chatIds = userChatLinks.map(link => link.chat_id);
    if (chatIds.length === 0) return res.status(200).json([]);

    // 2. Get the details for all those chats, including participants
    const { data: chats, error: chatsError } = await supabase
      .from('chats')
      .select(`
        id,
        name,
        participants:user_chats(user:users(id, username))
      `)
      .in('id', chatIds);

    if (chatsError) throw chatsError;
    
    // 3. For each chat, fetch its last message in a separate, reliable query
    const formattedChats = await Promise.all(
      chats.map(async (chat) => {
        // --- THIS IS THE MODIFIED, MORE RELIABLE LOGIC ---
        const { data: lastMessageData, error: lastMessageError } = await supabase
          .from('messages')
          .select('body, created_at')
          .eq('chat_id', chat.id)
          .order('created_at', { ascending: false })
          .limit(1); // Fetches an array, max 1 item

        const otherParticipants = chat.participants.filter(p => p.user?.id !== userId);
        const chatName = chat.name || (otherParticipants.length > 0 ? otherParticipants.map(p => p.user.username).join(', ') : 'New Chat');
        
        const lastMessage = (lastMessageData && lastMessageData.length > 0) ? lastMessageData[0] : null;

        return {
          id: chat.id,
          name: chatName,
          participants: chat.participants,
          lastMessage: lastMessage ? {
            body: lastMessage.body,
            timestamp: lastMessage.created_at,
          } : null,
        };
      })
    );
    
    res.status(200).json(formattedChats);

  } catch (error) {
    console.error('Error fetching chats:', error);
    res.status(500).json({ error: error.message });
  }
});


// GET /api/chats/:chatId
app.get('/api/chats/:chatId', async (req, res) => {
  const { chatId } = req.params;
  const { data, error } = await supabase
    .from('chats')
    .select(`
      id,
      name,
      participants:user_chats(user:users(id, username))
    `)
    .eq('id', chatId)
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Chat not found' });
  
  res.status(200).json(data);
});

// GET /api/chats/:chatId/messages
app.get('/api/chats/:chatId/messages', async (req, res) => {
  const { chatId } = req.params;
  const { data, error } = await supabase
    .from('messages')
    .select('id, body, created_at, sender_id, sender:users(username)')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.status(200).json(data);
});

// GET /api/messages/:messageId
app.get('/api/messages/:messageId', async (req, res) => {
    const { messageId } = req.params;
    const { data, error } = await supabase
      .from('messages')
      .select('id, body, created_at, sender_id, sender:users(username)')
      .eq('id', messageId)
      .single();
  
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Message not found' });

    res.status(200).json(data);
});


// POST /api/chats/:chatId/messages
app.post('/api/chats/:chatId/messages', async (req, res) => {
  const { chatId } = req.params;
  const { sender_id, body } = req.body;
  const { data, error } = await supabase
    .from('messages')
    .insert([{ chat_id: chatId, sender_id, body }])
    .select('id, body, created_at, sender_id, sender:users(username)')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

app.listen(port, () => {
  console.log(`Backend server running on http://localhost:${port}`);
});

