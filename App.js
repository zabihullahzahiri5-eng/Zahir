import React, { useState, useEffect, useRef } from "react";
import * as ImagePicker from "expo-image-picker";
import {
    SafeAreaView,
    View,
    Text,
    TextInput,
    TouchableOpacity,
    Pressable,
    ScrollView,
    FlatList,
    StatusBar,
    Modal,
    Alert,
    StyleSheet,
    Image,
    Share,
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
    PermissionsAndroid,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { auth, db } from "./firebase";


const STORAGE_KEYS = {
    SESSION: "APP_SESSION",
    PINNED_CHATS_PREFIX: "PINNED_CHATS_",
};

const CHAT_THEMES = {
    default: { myBubble: "#3B82F6", sendButton: "#3B82F6" },
    forest: { myBubble: "#16A34A", sendButton: "#16A34A" },
    sunset: { myBubble: "#EA580C", sendButton: "#EA580C" },
};

// WebRTC for real audio calls
let RTCPeerConnection, RTCSessionDescription, RTCIceCandidate, webrtcMediaDevices;
try {
    const webrtc = require('react-native-webrtc');
    RTCPeerConnection = webrtc.RTCPeerConnection;
    RTCSessionDescription = webrtc.RTCSessionDescription;
    RTCIceCandidate = webrtc.RTCIceCandidate;
    webrtcMediaDevices = webrtc.mediaDevices;
} catch (e) {
    console.warn('WebRTC not available:', e.message);
}

const ICE_SERVERS = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
    ],
};

const AVATAR_COLORS = [
    "#3B82F6", "#4CAF50", "#9C27B0", "#FF9800", "#795548",
    "#E91E63", "#009688", "#3F51B5", "#FF5722", "#607D8B",
];

export default function App() {
    const [isLoading, setIsLoading] = useState(true);
    const [currentUser, setCurrentUser] = useState(null);
    const [screen, setScreen] = useState("welcome");
    const [startupError, setStartupError] = useState(null);
    const [startupRetryCount, setStartupRetryCount] = useState(0);

    // Login State
    const [loginEmail, setLoginEmail] = useState("");
    const [loginPassword, setLoginPassword] = useState("");
    const [loginLoading, setLoginLoading] = useState(false);

    // Register State
    const [regFullName, setRegFullName] = useState("");
    const [regEmail, setRegEmail] = useState("");
    const [regPassword, setRegPassword] = useState("");
    const [regConfirmPassword, setRegConfirmPassword] = useState("");
    const [agreeTerms, setAgreeTerms] = useState(false);

    // Profile State
    const [editingProfile, setEditingProfile] = useState(false);
    const [editName, setEditName] = useState("");

    // Chat State
    const [chatMessages, setChatMessages] = useState({});
    const [selectedFriend, setSelectedFriend] = useState(null);
    const [messageText, setMessageText] = useState("");
    const [editingMessage, setEditingMessage] = useState(null);
    const [selectedMessage, setSelectedMessage] = useState(null);
    const [isChatMuted, setIsChatMuted] = useState(false);
    const [chatTheme, setChatTheme] = useState("default");
    const [disappearingHours, setDisappearingHours] = useState(0);
    const [isShortcutAdded, setIsShortcutAdded] = useState(false);
    const [pinnedChatIds, setPinnedChatIds] = useState([]);
    const flatListRef = useRef(null);
    const messageInputRef = useRef(null);

    // Call State
    const [callState, setCallState] = useState(null);
    const [callPartner, setCallPartner] = useState(null);
    const [callDoc, setCallDoc] = useState(null);
    const [callDuration, setCallDuration] = useState(0);
    const [isMuted, setIsMuted] = useState(false);
    const [isSpeaker, setIsSpeaker] = useState(false);
    const callTimerRef = useRef(null);
    const callStateRef = useRef(null);
    const peerConnectionRef = useRef(null);
    const localStreamRef = useRef(null);
    const candidateUnsubRef = useRef(null);

    const chatMessagesRef = useRef(chatMessages);
    chatMessagesRef.current = chatMessages;

    // Friend System State
    const [friendsList, setFriendsList] = useState([]);
    const [friendRequests, setFriendRequests] = useState([]);
    const [allUsers, setAllUsers] = useState([]);
    const [usersLoading, setUsersLoading] = useState(true);
    const [usersError, setUsersError] = useState(null);
    const [blockedUsers, setBlockedUsers] = useState([]);
    const [blockedByUsers, setBlockedByUsers] = useState([]);

    // UI State
    const [searchQuery, setSearchQuery] = useState("");
    const [viewProfileUser, setViewProfileUser] = useState(null);
    const [userPreviewReturnScreen, setUserPreviewReturnScreen] = useState("findFriends");
    const [chatMenuVisible, setChatMenuVisible] = useState(false);
    const [chatMoreMenuVisible, setChatMoreMenuVisible] = useState(false);

    // Modals
    const [termsModalVisible, setTermsModalVisible] = useState(false);
    const [privacyModalVisible, setPrivacyModalVisible] = useState(false);

    // Helper Functions
    const renderAvatar = (user, containerStyle, textStyle, fallbackId) => {
        const avatarUri = user?.photoUri;
        // Use custom icon as fallback
        if (avatarUri) {
            return (
                <Image
                    source={{ uri: avatarUri }}
                    style={[containerStyle, styles.avatarImage]}
                />
            );
        }
        return (
            <Image
                source={require('./assets/account_icon.png')}
                style={[containerStyle, styles.avatarImage]}
            />
        );
    };

    const generateUserColor = (uid) => {
        const hash = uid?.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0) || 0;
        return AVATAR_COLORS[hash % AVATAR_COLORS.length];
    };

    const formatTime = (timestamp) => {
        if (!timestamp) return "";
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        const now = new Date();
        const diff = now - date;
        if (diff < 60000) return "Just now";
        if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
        if (diff < 86400000) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    };

    const getFriendRequestId = (fromUserId, toUserId) => `${fromUserId}_${toUserId}`;

    const getFriendDocId = (userId, friendId) => `${userId}_${friendId}`;

    const getBlockDocId = (blockedBy, blockedUser) => `${blockedBy}_${blockedUser}`;

    const isBlockedRelationship = (userId) => blockedUsers.includes(userId) || blockedByUsers.includes(userId);

    const ensureActiveRelationship = (user) => {
        if (!user?.id) {
            throw new Error("User not found.");
        }
        if (isBlockedRelationship(user.id)) {
            throw new Error("This user is blocked or has blocked you.");
        }
    };

    const canChatWithUser = (userId) => friendsList.some(friend => friend.id === userId) && !isBlockedRelationship(userId);

    const getSelectedFriendLinkId = (friend = selectedFriend) => {
        if (!currentUser || !friend?.id) {
            return null;
        }

        return friend.friendshipDocId || getFriendDocId(currentUser.uid, friend.id);
    };

    const getProfilePhotoStoragePath = (userId) => `profilePhotos/${userId}/avatar.jpg`;

    const normalizeUploadUri = (uri) => uri?.startsWith("file://") ? uri.replace("file://", "") : uri;

    const saveProfilePhotoFallback = async (asset) => {
        const fallbackUri = asset.base64 ? `data:${asset.mimeType || 'image/jpeg'};base64,${asset.base64}` : asset.uri;

        if (!fallbackUri) {
            throw new Error("Selected image is invalid.");
        }

        await getFirestore().collection('users').doc(currentUser.uid).set({
            photoUri: fallbackUri,
        }, { merge: true });

        setCurrentUser(prev => ({ ...prev, photoUri: fallbackUri }));
    };

    // Navigation
    const goBack = () => {
        setSearchQuery("");
        setEditingMessage(null);
        setMessageText("");
        if (screen === "register") setScreen("welcome");
        else if (screen === "home") setScreen("dashboard");
        else if (screen === "chat") setScreen("home");
        else if (screen === "friendRequests") setScreen("dashboard");
        else if (screen === "profile") setScreen("dashboard");
        else if (screen === "findFriends") setScreen("dashboard");
        else if (screen === "userPreview") setScreen(userPreviewReturnScreen || "findFriends");
        else setScreen("dashboard");
    };

    const handleStartupRetry = () => {
        setStartupError(null);
        setIsLoading(true);
        setStartupRetryCount(prev => prev + 1);
    };

    const pickProfilePhoto = async () => {
        try {
            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ['images'],
                allowsEditing: true,
                aspect: [1, 1],
                quality: 0.4,
                base64: true,
            });

            if (result.canceled || !result.assets?.length) {
                return;
            }

            const asset = result.assets[0];
            if (!asset.uri) {
                Alert.alert("Error", "Selected image is invalid.");
                return;
            }

            try {
                const storagePath = getProfilePhotoStoragePath(currentUser.uid);
                const storageRef = getStorage().ref(storagePath);
                await storageRef.putFile(normalizeUploadUri(asset.uri));
                const downloadUrl = await storageRef.getDownloadURL();

                await getFirestore().collection('users').doc(currentUser.uid).set({
                    photoUri: downloadUrl,
                }, { merge: true });

                setCurrentUser(prev => ({ ...prev, photoUri: downloadUrl }));
            } catch (storageError) {
                console.warn("Falling back to Firestore-based profile photo storage", storageError);
                await saveProfilePhotoFallback(asset);
            }

            Alert.alert("Success", "Profile photo updated");
        } catch (error) {
            console.error("Profile photo update failed", error);
            Alert.alert("Error", "Failed to update profile photo");
        }
    };

    // ==================== FIREBASE AUTH STATE ====================
    useEffect(() => {
        let unsubscribe = null;
        try {
            unsubscribe = getAuth().onAuthStateChanged(async (user) => {
                try {
                    if (user) {
                        // Always ensure user document exists in Firestore
                        const userRef = getFirestore().collection('users').doc(user.uid);
                        const userDoc = await userRef.get();
                        if (userDoc.exists) {
                            const existingData = userDoc.data();
                            // Ensure fullName exists, update lastLogin
                            const updates = {
                                uid: user.uid,
                                email: user.email,
                                lastLogin: getFirestoreModule().FieldValue.serverTimestamp(),
                            };
                            if (!existingData.fullName) {
                                updates.fullName = user.displayName || user.email?.split('@')[0] || "User";
                            }
                            await userRef.set(updates, { merge: true });
                            setCurrentUser({ uid: user.uid, ...existingData, ...updates, lastLogin: undefined });
                        } else {
                            // Create new user document
                            const newUserData = {
                                uid: user.uid,
                                email: user.email,
                                fullName: user.displayName || user.email?.split('@')[0] || "User",
                                bio: "New member",
                                createdAt: getFirestoreModule().FieldValue.serverTimestamp(),
                                lastLogin: getFirestoreModule().FieldValue.serverTimestamp(),
                            };
                            await userRef.set(newUserData);
                            setCurrentUser({ uid: user.uid, ...newUserData });
                        }
                        setScreen("dashboard");
                    } else {
                        setCurrentUser(null);
                        if (screen !== "welcome" && screen !== "register") {
                            setScreen("welcome");
                        }
                    }
                } catch (error) {
                    console.error("Firebase runtime error", error);
                    setStartupError("Firebase error: " + (error.message || String(error)));
                } finally {
                    setIsLoading(false);
                }
            });
        } catch (error) {
            console.error("Firebase startup failed", error);
            setStartupError("Firebase startup failed: " + (error.message || String(error)));
            setIsLoading(false);
        }
        return () => unsubscribe && unsubscribe();
    }, [startupRetryCount]);

    // ==================== FIREBASE LISTENERS ====================

    useEffect(() => {
        if (!currentUser) return;
        // Listen for incoming friend requests (to me)
        const unsubIncoming = getFirestore()
            .collection('friendRequests')
            .where('to', '==', currentUser.uid)
            .onSnapshot((snapshot) => {
                const requests = [];
                snapshot.forEach(doc => {
                    requests.push({ id: doc.id, ...doc.data() });
                });
                setFriendRequests(prev => {
                    const outgoing = prev.filter(r => r.from === currentUser.uid);
                    return [...requests, ...outgoing];
                });
            });
        // Listen for outgoing friend requests (from me)
        const unsubOutgoing = getFirestore()
            .collection('friendRequests')
            .where('from', '==', currentUser.uid)
            .onSnapshot((snapshot) => {
                const requests = [];
                snapshot.forEach(doc => {
                    requests.push({ id: doc.id, ...doc.data() });
                });
                setFriendRequests(prev => {
                    const incoming = prev.filter(r => r.to === currentUser.uid);
                    return [...incoming, ...requests];
                });
            });
        return () => { unsubIncoming(); unsubOutgoing(); };
    }, [currentUser]);

    useEffect(() => {
        if (!currentUser) {
            setBlockedUsers([]);
            setBlockedByUsers([]);
            return;
        }

        const unsubBlockedUsers = getFirestore()
            .collection('blocks')
            .where('blockedBy', '==', currentUser.uid)
            .onSnapshot((snapshot) => {
                const nextBlocked = snapshot.docs.map(doc => doc.data()?.blockedUser).filter(Boolean);
                setBlockedUsers(nextBlocked);
            });

        const unsubBlockedByUsers = getFirestore()
            .collection('blocks')
            .where('blockedUser', '==', currentUser.uid)
            .onSnapshot((snapshot) => {
                const nextBlockedBy = snapshot.docs.map(doc => doc.data()?.blockedBy).filter(Boolean);
                setBlockedByUsers(nextBlockedBy);
            });

        return () => {
            unsubBlockedUsers();
            unsubBlockedByUsers();
        };
    }, [currentUser]);

    useEffect(() => {
        if (!currentUser) return;
        const unsubscribe = getFirestore()
            .collection('friends')
            .where('userId', '==', currentUser.uid)
            .onSnapshot(async (snapshot) => {
                const friends = [];
                for (const doc of snapshot.docs) {
                    const friendData = doc.data();
                    const userDoc = await getFirestore().collection('users').doc(friendData.friendId).get();
                    if (userDoc.exists) {
                        friends.push({
                            id: userDoc.id,
                            friendshipDocId: doc.id,
                            ...userDoc.data(),
                        });
                    }
                }
                setFriendsList(friends);
            });
        return () => unsubscribe();
    }, [currentUser]);

    useEffect(() => {
        if (selectedFriend && isBlockedRelationship(selectedFriend.id) && screen === "chat") {
            Alert.alert("Access blocked", "You can no longer message this user.");
            goBack();
        }
    }, [selectedFriend, blockedUsers, blockedByUsers, screen]);

    useEffect(() => {
        if (!currentUser || !selectedFriend) return;
        const chatId = [currentUser.uid, selectedFriend.id].sort().join('_');
        let unsubscribe = null;
        let retryCount = 0;

        const startListener = () => {
            unsubscribe = getFirestore()
                .collection('messages')
                .doc(chatId)
                .collection('chats')
                .orderBy('timestamp', 'asc')
                .onSnapshot((snapshot) => {
                    retryCount = 0;
                    const messages = [];
                    snapshot.forEach(doc => {
                        messages.push({ id: doc.id, ...doc.data() });
                    });
                    setChatMessages(prev => ({ ...prev, [chatId]: messages }));

                    // Auto-scroll to bottom if user is near bottom
                    if (flatListRef.current?._isNearBottom !== false) {
                        setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
                    }
                }, (error) => {
                    console.warn('Chat listener error:', error.code, error.message);
                    if (retryCount < 3) {
                        retryCount++;
                        setTimeout(() => startListener(), 2000 * retryCount);
                    } else {
                        Alert.alert("Chat Error", `Could not load messages.\nCode: ${error.code || 'unknown'}\n${error.message || error}`);
                    }
                });
        };

        startListener();
        return () => { if (unsubscribe) unsubscribe(); };
    }, [currentUser, selectedFriend]);

    // Mark messages as read when entering chat screen
    useEffect(() => {
        if (screen !== "chat" || !selectedFriend || !currentUser) return;
        const chatId = [currentUser.uid, selectedFriend.id].sort().join('_');

        // Small delay to let onSnapshot populate messages first
        const timer = setTimeout(() => {
            const messages = chatMessagesRef.current[chatId] || [];
            const unread = messages.filter(m => m.senderId === selectedFriend.id && !m.read);
            for (const msg of unread) {
                getFirestore()
                    .collection('messages').doc(chatId)
                    .collection('chats').doc(msg.id)
                    .update({ read: true })
                    .catch((err) => {
                        console.warn('markRead failed:', err.code, err.message);
                    });
            }
        }, 500);

        return () => clearTimeout(timer);
    }, [screen, selectedFriend, currentUser]);

    useEffect(() => {
        if (screen !== "chat" || !selectedFriend) return;
        const focusTimer = setTimeout(() => {
            messageInputRef.current?.focus();
            flatListRef.current?.scrollToEnd({ animated: false });
        }, 150);

        return () => clearTimeout(focusTimer);
    }, [screen, selectedFriend]);

    useEffect(() => {
        if (!currentUser || !selectedFriend) {
            setIsChatMuted(false);
            setChatTheme("default");
            setDisappearingHours(0);
            setIsShortcutAdded(false);
            return;
        }

        const settingsId = `${currentUser.uid}_${selectedFriend.id}`;
        const unsubscribe = getFirestore()
            .collection('chatSettings')
            .doc(settingsId)
            .onSnapshot((doc) => {
                if (doc.exists) {
                    const data = doc.data() || {};
                    setIsChatMuted(!!data.muted);
                    setChatTheme(data.theme || "default");
                    setDisappearingHours(data.disappearingHours || 0);
                    setIsShortcutAdded(!!data.shortcutAdded);
                } else {
                    setIsChatMuted(false);
                    setChatTheme("default");
                    setDisappearingHours(0);
                    setIsShortcutAdded(false);
                }
            }, () => {
                setIsChatMuted(false);
                setChatTheme("default");
                setDisappearingHours(0);
                setIsShortcutAdded(false);
            });

        return () => unsubscribe();
    }, [currentUser, selectedFriend]);

    useEffect(() => {
        if (!currentUser) {
            setPinnedChatIds([]);
            return;
        }

        const loadPinnedChats = async () => {
            try {
                const key = `${STORAGE_KEYS.PINNED_CHATS_PREFIX}${currentUser.uid}`;
                const raw = await AsyncStorage.getItem(key);
                const parsed = raw ? JSON.parse(raw) : [];
                setPinnedChatIds(Array.isArray(parsed) ? parsed : []);
            } catch {
                setPinnedChatIds([]);
            }
        };

        loadPinnedChats();
    }, [currentUser]);

    useEffect(() => {
        if (!currentUser) return;
        setUsersLoading(true);
        setUsersError(null);

        // Use get() first for immediate results, then switch to onSnapshot for real-time
        const fetchUsers = async () => {
            try {
                const snapshot = await getFirestore().collection('users').get();
                const users = [];
                snapshot.forEach(doc => {
                    if (doc.id !== currentUser.uid) {
                        users.push({ id: doc.id, ...doc.data() });
                    }
                });
                setAllUsers(users);
                setUsersLoading(false);
            } catch (error) {
                console.error('Error fetching users (get):', error);
                setUsersLoading(false);
                setUsersError(error.message || 'Failed to load users');
            }
        };
        fetchUsers();

        // Then listen for real-time updates
        const unsubscribe = getFirestore()
            .collection('users')
            .onSnapshot((snapshot) => {
                const users = [];
                snapshot.forEach(doc => {
                    if (doc.id !== currentUser.uid) {
                        users.push({ id: doc.id, ...doc.data() });
                    }
                });
                setAllUsers(users);
                setUsersLoading(false);
                setUsersError(null);
            }, (error) => {
                console.error('Error fetching users (listener):', error);
                setUsersLoading(false);
                setUsersError(error.message || 'Failed to load users');
                Alert.alert('Error', 'Failed to load users: ' + (error.message || 'Unknown error'));
            });
        return () => unsubscribe();
    }, [currentUser]);

    // ==================== CALL LISTENERS ====================

    useEffect(() => {
        callStateRef.current = callState;
    }, [callState]);

    useEffect(() => {
        if (!currentUser) return;
        const unsubscribe = getFirestore()
            .collection('calls')
            .where('to', '==', currentUser.uid)
            .where('status', '==', 'ringing')
            .onSnapshot((snapshot) => {
                if (!snapshot.empty && !callStateRef.current) {
                    const doc = snapshot.docs[0];
                    const data = doc.data();
                    if (isBlockedRelationship(data.from)) {
                        return;
                    }
                    setCallState('incoming');
                    setCallPartner({ id: data.from, fullName: data.fromName });
                    setCallDoc({ id: doc.id, ...data });
                }
            });
        return () => unsubscribe();
    }, [currentUser, blockedUsers, blockedByUsers]);

    useEffect(() => {
        if (!callDoc?.id) return;
        const unsubscribe = getFirestore()
            .collection('calls')
            .doc(callDoc.id)
            .onSnapshot((doc) => {
                if (doc.exists) {
                    const data = doc.data();
                    if (data.status === 'active' && callStateRef.current !== 'active') {
                        setCallState('active');
                    } else if (data.status === 'ended') {
                        cleanupWebRTC();
                        setCallState(null);
                        setCallPartner(null);
                        setCallDoc(null);
                    }
                }
            });
        return () => unsubscribe();
    }, [callDoc?.id]);

    useEffect(() => {
        if (callState === 'active') {
            callTimerRef.current = setInterval(() => {
                setCallDuration(prev => prev + 1);
            }, 1000);
        } else {
            if (callTimerRef.current) clearInterval(callTimerRef.current);
            setCallDuration(0);
        }
        return () => { if (callTimerRef.current) clearInterval(callTimerRef.current); };
    }, [callState]);

    // ==================== WELCOME SCREEN ====================
    const [firebaseStatus, setFirebaseStatus] = useState(null);
    const testFirebaseConnection = async () => {
        setFirebaseStatus('Checking...');
        try {
            // Try to read a collection (users) from Firestore
            const snapshot = await db.collection('users').limit(1).get();
            setFirebaseStatus('✅ Connected to Firebase!');
        } catch (e) {
            setFirebaseStatus('❌ Firebase connection failed: ' + (e.message || e.toString()));
        }
    };
    if (screen === "welcome") {
        return (
            <SafeAreaView style={styles.container}>
                <StatusBar backgroundColor="#3B82F6" barStyle="light-content" />
                <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
                    <ScrollView contentContainerStyle={styles.scrollContainer}>
                        <View style={styles.loginContainer}>
                            <Text style={styles.logo}>💬</Text>
                            <Text style={styles.title}>YaraApp</Text>
                            <Text style={styles.subtitle}>Connect with friends</Text>
                            <TextInput style={styles.input} placeholder="Email" value={loginEmail} onChangeText={setLoginEmail} autoCapitalize="none" keyboardType="email-address" />
                            <TextInput style={styles.input} placeholder="Password" secureTextEntry value={loginPassword} onChangeText={setLoginPassword} />
                            <TouchableOpacity style={[styles.button, loginLoading && styles.buttonDisabled]} onPress={handleLogin} disabled={loginLoading}>
                                <Text style={styles.buttonText}>{loginLoading ? "Logging in..." : "Login"}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => setScreen("register")}>\n                                <Text style={styles.linkText}>Create New Account</Text>\n                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.button, { backgroundColor: '#10B981', marginTop: 10 }]} onPress={testFirebaseConnection}>
                                <Text style={styles.buttonText}>Test Firebase Connection</Text>
                            </TouchableOpacity>
                            {firebaseStatus && <Text style={{ marginTop: 10, color: firebaseStatus.startsWith('✅') ? '#10B981' : '#ef4444', textAlign: 'center' }}>{firebaseStatus}</Text>}
                            <View style={styles.footerLinks}>
                                <TouchableOpacity onPress={() => setTermsModalVisible(true)}><Text style={styles.footerLinkText}>Terms</Text></TouchableOpacity>
                                <Text style={styles.footerLinkSeparator}>•</Text>
                                <TouchableOpacity onPress={() => setPrivacyModalVisible(true)}><Text style={styles.footerLinkText}>Privacy</Text></TouchableOpacity>
                            </View>
                        </View>
                    </ScrollView>
                </KeyboardAvoidingView>
                <Modal visible={termsModalVisible} animationType="slide" transparent={false}>
                    <SafeAreaView style={styles.modalFullContainer}>
                        <View style={styles.modalFullHeader}><TouchableOpacity onPress={() => setTermsModalVisible(false)}><Text style={styles.modalFullClose}>← Back</Text></TouchableOpacity><Text style={styles.modalFullTitle}>Terms & Conditions</Text><View style={{ width: 50 }} /></View>
                        <TermsContent />
                    </SafeAreaView>
                </Modal>
                <Modal visible={privacyModalVisible} animationType="slide" transparent={false}>
                    <SafeAreaView style={styles.modalFullContainer}>
                        <View style={styles.modalFullHeader}><TouchableOpacity onPress={() => setPrivacyModalVisible(false)}><Text style={styles.modalFullClose}>← Back</Text></TouchableOpacity><Text style={styles.modalFullTitle}>Privacy Policy</Text><View style={{ width: 50 }} /></View>
                        <PrivacyContent />
                    </SafeAreaView>
                </Modal>
            </SafeAreaView>
        );
    }
    uid: userCredential.user.uid,
        fullName: regFullName,
            email: regEmail,
                bio: "New member",
                    createdAt: new Date(),
            });
Alert.alert("Welcome", "Account created successfully!");
setRegFullName(""); setRegEmail("");
setRegPassword(""); setRegConfirmPassword(""); setAgreeTerms(false);
        } catch (error) {
    Alert.alert("Error", error.message);
} finally {
    setLoginLoading(false);
}
    };

const handleLogout = async () => {
    Alert.alert("Logout", "Are you sure?", [
        { text: "Cancel", style: "cancel" },
        {
            text: "Logout",
            onPress: async () => {
                await auth.signOut();
                await AsyncStorage.removeItem(STORAGE_KEYS.SESSION);
                setCurrentUser(null);
                setScreen("welcome");
            },
        },
    ]);
};

const deleteAccount = () => {
    Alert.alert("Delete Account", "⚠️ This will permanently delete ALL your data!", [
        { text: "Cancel", style: "cancel" },
        {
            text: "Delete",
            style: "destructive",
            onPress: async () => {
                const user = getAuth().currentUser;
                if (user) {
                    try {
                        await getStorage().ref(getProfilePhotoStoragePath(user.uid)).delete();
                    } catch (error) {
                        if (error?.code !== 'storage/object-not-found') {
                            console.warn('Profile photo delete failed', error);
                        }
                    }
                    await getFirestore().collection('users').doc(user.uid).delete();
                    await user.delete();
                    Alert.alert("Deleted", "Your account has been deleted");
                }
            },
        },
    ]);
};

// ==================== FRIEND FUNCTIONS ====================

const sendFriendRequest = async (toUserId, toUserName) => {
    if (!toUserId || toUserId === currentUser.uid) {
        Alert.alert("Error", "Invalid friend request.");
        return;
    }
    if (isBlockedRelationship(toUserId)) {
        Alert.alert("Blocked", "You cannot send a request to this user.");
        return;
    }

    const requestId = getFriendRequestId(currentUser.uid, toUserId);
    const existing = await getFirestore().collection('friendRequests').doc(requestId).get();
    if (existing.exists) {
        Alert.alert("Info", "Request already sent");
        return;
    }

    await getFirestore().collection('friendRequests').doc(requestId).set({
        from: currentUser.uid,
        fromName: currentUser.fullName,
        to: toUserId,
        toName: toUserName,
        status: 'pending',
        timestamp: getFirestoreModule().FieldValue.serverTimestamp(),
    });
    Alert.alert("Success", "Friend request sent");
};

const acceptFriendRequest = async (request) => {
    if (!request?.from || request.to !== currentUser.uid) {
        Alert.alert("Error", "Invalid friend request.");
        return;
    }

    if (isBlockedRelationship(request.from)) {
        Alert.alert("Blocked", "You cannot accept a blocked user's request.");
        return;
    }

    try {
        const batch = getFirestore().batch();
        const addedAt = getFirestoreModule().FieldValue.serverTimestamp();

        batch.set(getFirestore().collection('friends').doc(getFriendDocId(currentUser.uid, request.from)), {
            userId: currentUser.uid,
            friendId: request.from,
            friendName: request.fromName,
            addedAt,
        });

        batch.set(getFirestore().collection('friends').doc(getFriendDocId(request.from, currentUser.uid)), {
            userId: request.from,
            friendId: currentUser.uid,
            friendName: currentUser.fullName,
            addedAt,
        });

        batch.delete(getFirestore().collection('friendRequests').doc(request.id));
        await batch.commit();

        Alert.alert("Success", `${request.fromName} is now your friend!`);
    } catch (error) {
        Alert.alert("Error", "Failed to accept friend request.");
    }
};

const declineFriendRequest = async (requestId) => {
    try {
        await getFirestore().collection('friendRequests').doc(requestId).delete();
        Alert.alert("Info", "Request declined");
    } catch {
        Alert.alert("Error", "Failed to decline request.");
    }
};

const removeFriend = async (friendId, friendName) => {
    Alert.alert("Remove Friend", `Remove ${friendName} from friends?`, [
        { text: "Cancel", style: "cancel" },
        {
            text: "Remove",
            style: "destructive",
            onPress: async () => {
                try {
                    const batch = getFirestore().batch();
                    batch.delete(getFirestore().collection('friends').doc(getFriendDocId(currentUser.uid, friendId)));
                    batch.delete(getFirestore().collection('friends').doc(getFriendDocId(friendId, currentUser.uid)));
                    await batch.commit();
                    Alert.alert("Removed", `${friendName} removed from friends`);
                    if (screen === "userPreview") goBack();
                } catch {
                    Alert.alert("Error", "Failed to remove friend.");
                }
            },
        },
    ]);
};

const blockUser = async (userId, userName) => {
    Alert.alert("Block " + userName, `Block ${userName}? They won't be able to message or call you.`, [
        { text: "Cancel", style: "cancel" },
        {
            text: "Block",
            style: "destructive",
            onPress: async () => {
                try {
                    const batch = getFirestore().batch();

                    batch.set(getFirestore().collection('blocks').doc(getBlockDocId(currentUser.uid, userId)), {
                        blockedBy: currentUser.uid,
                        blockedUser: userId,
                        blockedName: userName,
                        timestamp: getFirestoreModule().FieldValue.serverTimestamp(),
                    });

                    batch.delete(getFirestore().collection('friends').doc(getFriendDocId(currentUser.uid, userId)));
                    batch.delete(getFirestore().collection('friends').doc(getFriendDocId(userId, currentUser.uid)));
                    batch.delete(getFirestore().collection('friendRequests').doc(getFriendRequestId(currentUser.uid, userId)));
                    batch.delete(getFirestore().collection('friendRequests').doc(getFriendRequestId(userId, currentUser.uid)));
                    await batch.commit();
                    Alert.alert("Blocked", `${userName} has been blocked`);
                    if (screen === "userPreview") goBack();
                } catch (error) {
                    Alert.alert("Error", "Failed to block user");
                }
            },
        },
    ]);
};

const reportUser = async (userId, userName) => {
    if (userId === currentUser?.uid) {
        Alert.alert("Error", "You cannot report yourself.");
        return;
    }
    Alert.alert("Report " + userName, "Report this user for inappropriate behavior?", [
        { text: "Cancel", style: "cancel" },
        {
            text: "Report",
            style: "destructive",
            onPress: async () => {
                try {
                    await getFirestore().collection('reports').add({
                        reportedBy: currentUser.uid,
                        reportedUser: userId,
                        reportedName: userName,
                        reason: 'inappropriate behavior',
                        timestamp: getFirestoreModule().FieldValue.serverTimestamp(),
                    });
                    Alert.alert("Reported", "Thank you for your report. We will review it.");
                } catch (error) {
                    Alert.alert("Error", "Failed to submit report");
                }
            },
        },
    ]);
};

const clearChat = async (friendId, friendName) => {
    Alert.alert("Clear Chat", `Delete all messages with ${friendName}?`, [
        { text: "Cancel", style: "cancel" },
        {
            text: "Clear",
            style: "destructive",
            onPress: async () => {
                try {
                    const chatId = [currentUser.uid, friendId].sort().join('_');
                    const messagesSnap = await getFirestore()
                        .collection('messages')
                        .doc(chatId)
                        .collection('chats')
                        .get();
                    const batch = getFirestore().batch();
                    messagesSnap.forEach(doc => batch.delete(doc.ref));
                    await batch.commit();
                    setChatMessages(prev => ({ ...prev, [chatId]: [] }));
                    Alert.alert("Cleared", "Chat history deleted");
                } catch (error) {
                    Alert.alert("Error", "Failed to clear chat");
                }
            },
        },
    ]);
};

// ==================== CHAT FUNCTIONS ====================

const sendMessage = async () => {
    const trimmedMessage = messageText.trim();
    if (!trimmedMessage || !selectedFriend) return;

    if (!canChatWithUser(selectedFriend.id)) {
        const friendFound = friendsList.some(f => f.id === selectedFriend.id);
        const blocked = isBlockedRelationship(selectedFriend.id);
        Alert.alert("Unavailable", `Cannot send message.\nFriend in list: ${friendFound}\nBlocked: ${blocked}\nFriends loaded: ${friendsList.length}`);
        return;
    }

    if (trimmedMessage.length > 2000) {
        Alert.alert("Message too long", "Keep messages under 2000 characters.");
        return;
    }

    const chatId = [currentUser.uid, selectedFriend.id].sort().join('_');

    if (editingMessage) {
        try {
            await getFirestore()
                .collection('messages')
                .doc(chatId)
                .collection('chats')
                .doc(editingMessage.id)
                .update({
                    text: trimmedMessage,
                    editedAt: getFirestoreModule().FieldValue.serverTimestamp(),
                });
            setEditingMessage(null);
            setMessageText("");
        } catch (error) {
            Alert.alert("Edit Error", `Code: ${error.code || 'unknown'}\n${error.message || error}`);
        }
        return;
    }

    const newMessage = {
        text: trimmedMessage,
        senderId: currentUser.uid,
        senderName: currentUser.fullName,
        receiverId: selectedFriend.id,
        friendLinkId: getSelectedFriendLinkId(),
        timestamp: getFirestoreModule().FieldValue.serverTimestamp(),
        read: false,
    };

    if (disappearingHours > 0) {
        newMessage.expiresAt = getFirestoreModule().Timestamp.fromDate(
            new Date(Date.now() + disappearingHours * 60 * 60 * 1000)
        );
    }

    try {
        await getFirestore()
            .collection('messages')
            .doc(chatId)
            .collection('chats')
            .add(newMessage);
        setMessageText("");
        setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (error) {
        Alert.alert("Send Error", `Code: ${error.code || 'unknown'}\n${error.message || error}\n\nfriendLinkId: ${newMessage.friendLinkId}\nchatId: ${chatId}`);
    }
};

const startEditingMessage = (message) => {
    setEditingMessage(message);
    setMessageText(message.text || "");
    setTimeout(() => messageInputRef.current?.focus(), 100);
};

const cancelEditingMessage = () => {
    setEditingMessage(null);
    setMessageText("");
};

const deleteMessage = async (message) => {
    if (!currentUser || !selectedFriend) return;
    Alert.alert(
        "Delete Message",
        message.senderId === currentUser.uid
            ? "Delete this message? It will be removed for everyone."
            : "Delete this message from your view?",
        [
            { text: "Cancel", style: "cancel" },
            {
                text: "Delete",
                style: "destructive",
                onPress: async () => {
                    try {
                        const chatId = [currentUser.uid, selectedFriend.id].sort().join('_');
                        await getFirestore()
                            .collection('messages')
                            .doc(chatId)
                            .collection('chats')
                            .doc(message.id)
                            .delete();
                    } catch (error) {
                        Alert.alert("Error", "Failed to delete message.");
                    }
                },
            },
        ]
    );
};

const showMessageActions = (message) => {
    const isMyMessage = message.senderId === currentUser.uid;
    const buttons = [];

    buttons.push({
        text: "Copy Text",
        onPress: () => {
            try {
                Share.share({ message: message.text });
            } catch { }
        },
    });

    if (isMyMessage) {
        buttons.push({
            text: "Edit",
            onPress: () => startEditingMessage(message),
        });
    }

    buttons.push({
        text: "Delete",
        style: "destructive",
        onPress: () => deleteMessage(message),
    });

    buttons.push({ text: "Cancel", style: "cancel" });

    Alert.alert("Message", message.text.length > 40 ? message.text.substring(0, 40) + "..." : message.text, buttons);
};

const handleExportChat = async () => {
    if (!selectedFriend || !currentUser) return;
    const chatId = [currentUser.uid, selectedFriend.id].sort().join('_');
    const messages = chatMessages[chatId] || [];

    if (!messages.length) {
        Alert.alert("Export Chat", "No messages to export yet.");
        return;
    }

    const lines = messages
        .sort((a, b) => (a.timestamp?.toDate?.() || 0) - (b.timestamp?.toDate?.() || 0))
        .map((msg) => {
            const author = msg.senderId === currentUser.uid ? "You" : (selectedFriend.fullName || "Friend");
            const time = formatTime(msg.timestamp) || "Unknown time";
            return `[${time}] ${author}: ${msg.text || ""}`;
        });

    try {
        await Share.share({
            message: `Chat export with ${selectedFriend.fullName}\n\n${lines.join("\n")}`,
            title: `Chat with ${selectedFriend.fullName}`,
        });
    } catch {
        Alert.alert("Error", "Unable to export chat right now.");
    }
};

const toggleChatNotifications = async () => {
    if (!currentUser || !selectedFriend) return;

    try {
        const settingsId = `${currentUser.uid}_${selectedFriend.id}`;
        const nextMuted = !isChatMuted;
        await getFirestore()
            .collection('chatSettings')
            .doc(settingsId)
            .set({
                userId: currentUser.uid,
                friendId: selectedFriend.id,
                friendLinkId: getSelectedFriendLinkId(),
                muted: nextMuted,
                updatedAt: getFirestoreModule().FieldValue.serverTimestamp(),
            }, { merge: true });

        setIsChatMuted(nextMuted);
        Alert.alert("Notifications", nextMuted ? "Notifications muted" : "Notifications enabled");
    } catch (error) {
        Alert.alert("Error", "Failed to update notification settings");
    }
};

const handleAddToContacts = async () => {
    if (!currentUser || !selectedFriend) return;
    if (isBlockedRelationship(selectedFriend.id)) {
        Alert.alert("Blocked", "You cannot add this user while a block is active.");
        return;
    }

    const alreadyFriend = friendsList.some(f => f.id === selectedFriend.id);
    const alreadySent = friendRequests.some(r => r.from === currentUser.uid && r.to === selectedFriend.id);
    const alreadyReceived = friendRequests.some(r => r.from === selectedFriend.id && r.to === currentUser.uid);

    if (alreadyFriend) {
        Alert.alert("Contacts", `${selectedFriend.fullName} is already in your contacts.`);
        return;
    }

    if (alreadySent) {
        Alert.alert("Contacts", `Friend request to ${selectedFriend.fullName} is pending.`);
        return;
    }

    if (alreadyReceived) {
        const incomingRequest = friendRequests.find(r => r.from === selectedFriend.id && r.to === currentUser.uid);
        if (incomingRequest) {
            await acceptFriendRequest(incomingRequest);
            return;
        }
    }

    await sendFriendRequest(selectedFriend.id, selectedFriend.fullName);
};

const toggleDisappearingMessages = async () => {
    if (!currentUser || !selectedFriend) return;

    const nextHours = disappearingHours > 0 ? 0 : 24;
    const settingsId = `${currentUser.uid}_${selectedFriend.id}`;

    try {
        await getFirestore()
            .collection('chatSettings')
            .doc(settingsId)
            .set({
                userId: currentUser.uid,
                friendId: selectedFriend.id,
                friendLinkId: getSelectedFriendLinkId(),
                disappearingHours: nextHours,
                updatedAt: getFirestoreModule().FieldValue.serverTimestamp(),
            }, { merge: true });

        setDisappearingHours(nextHours);
        Alert.alert("Disappearing messages", nextHours > 0 ? "Enabled (24 hours)" : "Disabled");
    } catch {
        Alert.alert("Error", "Failed to update disappearing messages setting.");
    }
};

const cycleChatTheme = async () => {
    if (!currentUser || !selectedFriend) return;

    const themeOrder = Object.keys(CHAT_THEMES);
    const currentIndex = themeOrder.indexOf(chatTheme);
    const nextTheme = themeOrder[(currentIndex + 1) % themeOrder.length];
    const settingsId = `${currentUser.uid}_${selectedFriend.id}`;

    try {
        await getFirestore()
            .collection('chatSettings')
            .doc(settingsId)
            .set({
                userId: currentUser.uid,
                friendId: selectedFriend.id,
                friendLinkId: getSelectedFriendLinkId(),
                theme: nextTheme,
                updatedAt: getFirestoreModule().FieldValue.serverTimestamp(),
            }, { merge: true });

        setChatTheme(nextTheme);
        Alert.alert("Chat theme", `Theme changed to ${nextTheme}`);
    } catch {
        Alert.alert("Error", "Failed to change chat theme.");
    }
};

const toggleChatShortcut = async () => {
    if (!currentUser || !selectedFriend) return;

    const nextPinned = !isShortcutAdded;
    const key = `${STORAGE_KEYS.PINNED_CHATS_PREFIX}${currentUser.uid}`;

    try {
        const updatedPinnedIds = nextPinned
            ? Array.from(new Set([...pinnedChatIds, selectedFriend.id]))
            : pinnedChatIds.filter(id => id !== selectedFriend.id);

        await AsyncStorage.setItem(key, JSON.stringify(updatedPinnedIds));
        setPinnedChatIds(updatedPinnedIds);

        const settingsId = `${currentUser.uid}_${selectedFriend.id}`;
        await getFirestore()
            .collection('chatSettings')
            .doc(settingsId)
            .set({
                userId: currentUser.uid,
                friendId: selectedFriend.id,
                friendLinkId: getSelectedFriendLinkId(),
                shortcutAdded: nextPinned,
                updatedAt: getFirestoreModule().FieldValue.serverTimestamp(),
            }, { merge: true });

        setIsShortcutAdded(nextPinned);
        Alert.alert("Shortcut", nextPinned ? "Chat pinned to top." : "Chat unpinned.");
    } catch {
        Alert.alert("Error", "Failed to update shortcut.");
    }
};

const showMediaLinksSummary = () => {
    if (!selectedFriend || !currentUser) return;

    const chatId = [currentUser.uid, selectedFriend.id].sort().join('_');
    const messages = chatMessages[chatId] || [];
    const linkRegex = /(https?:\/\/[^\s]+)/i;

    const linksCount = messages.filter(m => linkRegex.test(m.text || "")).length;
    const mediaCount = messages.filter(m => /\.(jpg|jpeg|png|gif|webp|mp4|mov)$/i.test(m.text || "")).length;

    Alert.alert(
        "Media, links and docs",
        `Links: ${linksCount}\nMedia mentions: ${mediaCount}\nMessages: ${messages.length}`
    );
};

const showEncryptionInfo = () => {
    Alert.alert("Encryption", "Messages are encrypted in transit and protected by Firebase security rules.");
};

const showStarredMessages = () => {
    Alert.alert("Starred messages", "Starred messages support is active as an info panel; no starred items yet.");
};

const openChatMainMenu = () => {
    setChatMoreMenuVisible(false);
    setChatMenuVisible(true);
};

const openChatMoreMenu = () => {
    setChatMenuVisible(false);
    setChatMoreMenuVisible(true);
};

const closeChatMenus = () => {
    setChatMenuVisible(false);
    setChatMoreMenuVisible(false);
};

// ==================== CALL FUNCTIONS ====================

const cleanupWebRTC = () => {
    if (candidateUnsubRef.current) {
        candidateUnsubRef.current();
        candidateUnsubRef.current = null;
    }
    if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
        peerConnectionRef.current = null;
    }
    if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
        localStreamRef.current = null;
    }
    setIsMuted(false);
    setIsSpeaker(false);
};

const requestAudioPermission = async () => {
    if (Platform.OS === 'android') {
        const granted = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
            {
                title: 'Microphone Permission',
                message: 'YaraApp needs microphone access for voice calls.',
                buttonPositive: 'Allow',
            }
        );
        return granted === PermissionsAndroid.RESULTS.GRANTED;
    }
    return true;
};

const initiateCall = async (friend) => {
    if (!friend?.id || !canChatWithUser(friend.id)) {
        Alert.alert('Unavailable', 'You can only call active friends who are not blocked.');
        return;
    }

    const hasPermission = await requestAudioPermission();
    if (!hasPermission) {
        Alert.alert('Permission Required', 'Microphone access is needed for calls.');
        return;
    }

    setCallPartner(friend);
    setCallState('calling');

    try {
        const callDocRef = await getFirestore().collection('calls').add({
            from: currentUser.uid,
            fromName: currentUser.fullName,
            to: friend.id,
            toName: friend.fullName,
            callerFriendLinkId: getSelectedFriendLinkId(friend),
            status: 'ringing',
            timestamp: getFirestoreModule().FieldValue.serverTimestamp(),
        });

        const callId = callDocRef.id;
        setCallDoc({ id: callId, from: currentUser.uid, to: friend.id });

        if (!webrtcMediaDevices) return;

        const stream = await webrtcMediaDevices.getUserMedia({ audio: true, video: false });
        localStreamRef.current = stream;

        const pc = new RTCPeerConnection(ICE_SERVERS);
        peerConnectionRef.current = pc;

        stream.getTracks().forEach(track => pc.addTrack(track, stream));

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                getFirestore()
                    .collection('calls').doc(callId)
                    .collection('callerCandidates')
                    .add(event.candidate.toJSON());
            }
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        await getFirestore().collection('calls').doc(callId).update({
            offer: { type: offer.type, sdp: offer.sdp },
        });

        // Listen for answer from callee
        const unsubAnswer = getFirestore().collection('calls').doc(callId)
            .onSnapshot(async (snapshot) => {
                const data = snapshot.data();
                if (data?.answer && pc && !pc.currentRemoteDescription) {
                    try {
                        await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
                    } catch (e) { console.warn('setRemoteDescription error:', e); }
                }
            });

        // Listen for callee ICE candidates
        const unsubCandidates = getFirestore()
            .collection('calls').doc(callId)
            .collection('calleeCandidates')
            .onSnapshot((snapshot) => {
                snapshot.docChanges().forEach(async (change) => {
                    if (change.type === 'added') {
                        try {
                            await pc.addIceCandidate(new RTCIceCandidate(change.doc.data()));
                        } catch (e) { console.warn('addIceCandidate error:', e); }
                    }
                });
            });

        candidateUnsubRef.current = () => { unsubAnswer(); unsubCandidates(); };
    } catch (error) {
        console.error('Call setup error:', error);
        cleanupWebRTC();
        setCallState(null);
        setCallPartner(null);
        setCallDoc(null);
        Alert.alert('Error', 'Failed to start call: ' + error.message);
    }
};

const acceptCall = async () => {
    if (!callDoc) return;
    if (isBlockedRelationship(callDoc.from)) {
        Alert.alert('Blocked', 'This call is no longer available.');
        declineCall();
        return;
    }

    const hasPermission = await requestAudioPermission();
    if (!hasPermission) {
        Alert.alert('Permission Required', 'Microphone access is needed for calls.');
        return;
    }

    try {
        const callSnapshot = await getFirestore().collection('calls').doc(callDoc.id).get();
        const callData = callSnapshot.data();

        if (!callData?.offer || !webrtcMediaDevices) {
            await getFirestore().collection('calls').doc(callDoc.id).update({ status: 'active' });
            setCallState('active');
            return;
        }

        const stream = await webrtcMediaDevices.getUserMedia({ audio: true, video: false });
        localStreamRef.current = stream;

        const pc = new RTCPeerConnection(ICE_SERVERS);
        peerConnectionRef.current = pc;

        stream.getTracks().forEach(track => pc.addTrack(track, stream));

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                getFirestore()
                    .collection('calls').doc(callDoc.id)
                    .collection('calleeCandidates')
                    .add(event.candidate.toJSON());
            }
        };

        await pc.setRemoteDescription(new RTCSessionDescription(callData.offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        await getFirestore().collection('calls').doc(callDoc.id).update({
            status: 'active',
            answer: { type: answer.type, sdp: answer.sdp },
        });

        // Listen for caller ICE candidates
        const unsubCandidates = getFirestore()
            .collection('calls').doc(callDoc.id)
            .collection('callerCandidates')
            .onSnapshot((snapshot) => {
                snapshot.docChanges().forEach(async (change) => {
                    if (change.type === 'added') {
                        try {
                            await pc.addIceCandidate(new RTCIceCandidate(change.doc.data()));
                        } catch (e) { console.warn('addIceCandidate error:', e); }
                    }
                });
            });

        candidateUnsubRef.current = () => { unsubCandidates(); };
        setCallState('active');
    } catch (error) {
        console.error('Accept call error:', error);
        Alert.alert('Error', 'Failed to accept call: ' + error.message);
    }
};

const endCall = async () => {
    if (callDoc) {
        try {
            await getFirestore().collection('calls').doc(callDoc.id).update({ status: 'ended' });
        } catch (e) { }
    }
    cleanupWebRTC();
    setCallState(null);
    setCallPartner(null);
    setCallDoc(null);
};

const declineCall = async () => {
    if (callDoc) {
        try {
            await getFirestore().collection('calls').doc(callDoc.id).update({ status: 'ended' });
        } catch (e) { }
    }
    cleanupWebRTC();
    setCallState(null);
    setCallPartner(null);
    setCallDoc(null);
};

const toggleMute = () => {
    if (localStreamRef.current) {
        const audioTrack = localStreamRef.current.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            setIsMuted(!audioTrack.enabled);
        }
    }
};

const formatCallDuration = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

// ==================== TERMS & PRIVACY CONTENT ====================
const TermsContent = () => (
    <ScrollView style={styles.termsContainer}>
        <Text style={styles.termsTitle}>Terms & Conditions</Text>
        <Text style={styles.termsHeading}>1. Acceptance of Terms</Text>
        <Text style={styles.termsText}>By creating an account and using YaraApp, you agree to be bound by these Terms & Conditions.</Text>
        <Text style={styles.termsHeading}>2. User Conduct</Text>
        <Text style={styles.termsText}>Be respectful to other users. No harassment, hate speech, or bullying.</Text>
        <Text style={styles.termsHeading}>3. Privacy</Text>
        <Text style={styles.termsText}>Your privacy is important. Read our Privacy Policy for more information.</Text>
        <Text style={styles.termsHeading}>4. Age Requirement</Text>
        <Text style={styles.termsText}>You must be at least 13 years old to use this application.</Text>
        <Text style={styles.termsHeading}>5. Account Termination</Text>
        <Text style={styles.termsText}>We reserve the right to suspend or terminate accounts that violate these terms.</Text>
        <Text style={styles.termsText}>Last updated: April 2026</Text>
    </ScrollView>
);

const PrivacyContent = () => (
    <ScrollView style={styles.termsContainer}>
        <Text style={styles.termsTitle}>Privacy Policy</Text>
        <Text style={styles.termsHeading}>1. Information We Collect</Text>
        <Text style={styles.termsText}>We collect account information (name, email), profile photos, and chat messages.</Text>
        <Text style={styles.termsHeading}>2. How We Use Your Information</Text>
        <Text style={styles.termsText}>To provide messaging features, connect you with friends, and improve the app.</Text>
        <Text style={styles.termsHeading}>3. Data Storage</Text>
        <Text style={styles.termsText}>All data is stored securely using Firebase.</Text>
        <Text style={styles.termsHeading}>4. Data Sharing</Text>
        <Text style={styles.termsText}>We do not sell or share your personal information with third parties.</Text>
        <Text style={styles.termsHeading}>5. Your Rights</Text>
        <Text style={styles.termsText}>You can delete your account anytime from Profile Settings.</Text>
        <Text style={styles.termsText}>Last updated: April 2026</Text>
    </ScrollView>
);

// ==================== STARTUP ERROR SCREEN ====================
if (startupError) {
    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.errorContainer}>
                <Text style={styles.errorTitle}>Initialization Error</Text>
                <Text style={styles.errorText}>{startupError}</Text>
                <TouchableOpacity style={styles.button} onPress={handleStartupRetry}>
                    <Text style={styles.buttonText}>Retry</Text>
                </TouchableOpacity>
            </View>
        </SafeAreaView>
    );
}

// ==================== LOADING SCREEN ====================
if (isLoading) {
    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#3B82F6" />
                <Text style={styles.loadingText}>Loading...</Text>
            </View>
        </SafeAreaView>
    );
}

// ==================== WELCOME SCREEN ====================
if (screen === "welcome") {
    return (
        <SafeAreaView style={styles.container}>
            <StatusBar backgroundColor="#3B82F6" barStyle="light-content" />
            <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
                <ScrollView contentContainerStyle={styles.scrollContainer}>
                    <View style={styles.loginContainer}>
                        <Text style={styles.logo}>💬</Text>
                        <Text style={styles.title}>YaraApp</Text>
                        <Text style={styles.subtitle}>Connect with friends</Text>
                        <TextInput style={styles.input} placeholder="Email" value={loginEmail} onChangeText={setLoginEmail} autoCapitalize="none" keyboardType="email-address" />
                        <TextInput style={styles.input} placeholder="Password" secureTextEntry value={loginPassword} onChangeText={setLoginPassword} />
                        <TouchableOpacity style={[styles.button, loginLoading && styles.buttonDisabled]} onPress={handleLogin} disabled={loginLoading}>
                            <Text style={styles.buttonText}>{loginLoading ? "Logging in..." : "Login"}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => setScreen("register")}>
                            <Text style={styles.linkText}>Create New Account</Text>
                        </TouchableOpacity>
                        <View style={styles.footerLinks}>
                            <TouchableOpacity onPress={() => setTermsModalVisible(true)}><Text style={styles.footerLinkText}>Terms</Text></TouchableOpacity>
                            <Text style={styles.footerLinkSeparator}>•</Text>
                            <TouchableOpacity onPress={() => setPrivacyModalVisible(true)}><Text style={styles.footerLinkText}>Privacy</Text></TouchableOpacity>
                        </View>
                    </View>
                </ScrollView>
            </KeyboardAvoidingView>
            <Modal visible={termsModalVisible} animationType="slide" transparent={false}>
                <SafeAreaView style={styles.modalFullContainer}>
                    <View style={styles.modalFullHeader}><TouchableOpacity onPress={() => setTermsModalVisible(false)}><Text style={styles.modalFullClose}>← Back</Text></TouchableOpacity><Text style={styles.modalFullTitle}>Terms & Conditions</Text><View style={{ width: 50 }} /></View>
                    <TermsContent />
                </SafeAreaView>
            </Modal>
            <Modal visible={privacyModalVisible} animationType="slide" transparent={false}>
                <SafeAreaView style={styles.modalFullContainer}>
                    <View style={styles.modalFullHeader}><TouchableOpacity onPress={() => setPrivacyModalVisible(false)}><Text style={styles.modalFullClose}>← Back</Text></TouchableOpacity><Text style={styles.modalFullTitle}>Privacy Policy</Text><View style={{ width: 50 }} /></View>
                    <PrivacyContent />
                </SafeAreaView>
            </Modal>
        </SafeAreaView>
    );
}

// ==================== REGISTER SCREEN ====================
if (screen === "register") {
    return (
        <SafeAreaView style={styles.container}>
            <StatusBar backgroundColor="#3B82F6" barStyle="light-content" />
            <TouchableOpacity style={styles.backButton} onPress={goBack}>
                <Text style={styles.backTextWhite}>← Back</Text>
            </TouchableOpacity>
            <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
                <ScrollView contentContainerStyle={styles.scrollContainer}>
                    <View style={styles.registerContainer}>
                        <Text style={styles.title}>Create Account</Text>
                        <TextInput style={styles.input} placeholder="Full Name *" value={regFullName} onChangeText={setRegFullName} />
                        <TextInput style={styles.input} placeholder="Email (Gmail) *" value={regEmail} onChangeText={setRegEmail} keyboardType="email-address" autoCapitalize="none" />
                        <TextInput style={styles.input} placeholder="Password * (min 6)" secureTextEntry value={regPassword} onChangeText={setRegPassword} />
                        <TextInput style={styles.input} placeholder="Confirm Password *" secureTextEntry value={regConfirmPassword} onChangeText={setRegConfirmPassword} />
                        <View style={styles.checkboxRow}>
                            <TouchableOpacity style={styles.checkbox} onPress={() => setAgreeTerms(!agreeTerms)}>
                                <Text style={styles.checkboxText}>{agreeTerms ? "✅" : "⬜"}</Text>
                            </TouchableOpacity>
                            <Text style={styles.checkboxLabel}>I agree to the </Text>
                            <TouchableOpacity onPress={() => setTermsModalVisible(true)}><Text style={styles.linkTextInline}>Terms</Text></TouchableOpacity>
                        </View>
                        <TouchableOpacity style={styles.button} onPress={handleRegister}><Text style={styles.buttonText}>Register</Text></TouchableOpacity>
                        <TouchableOpacity onPress={goBack}><Text style={styles.linkText}>Already have an account? Login</Text></TouchableOpacity>
                    </View>
                </ScrollView>
            </KeyboardAvoidingView>
            <Modal visible={termsModalVisible} animationType="slide" transparent={false}>
                <SafeAreaView style={styles.modalFullContainer}>
                    <View style={styles.modalFullHeader}><TouchableOpacity onPress={() => setTermsModalVisible(false)}><Text style={styles.modalFullClose}>← Back</Text></TouchableOpacity><Text style={styles.modalFullTitle}>Terms & Conditions</Text><View style={{ width: 50 }} /></View>
                    <TermsContent />
                </SafeAreaView>
            </Modal>
        </SafeAreaView>
    );
}

// ==================== DASHBOARD SCREEN ====================
if (screen === "dashboard" && currentUser) {
    const pendingCount = friendRequests.length;
    return (
        <SafeAreaView style={styles.container}>
            <StatusBar backgroundColor="#3B82F6" barStyle="light-content" />
            <View style={styles.dashboardHeader}>
                <TouchableOpacity onPress={() => setScreen("profile")} style={styles.profileButton}>
                    {renderAvatar(currentUser, styles.headerAvatarPlaceholder, styles.headerAvatarText, currentUser.uid)}
                    <View>
                        <Text style={styles.welcomeText}>Hello, {currentUser.fullName}</Text>
                        <Text style={styles.statsText}>{friendsList.length} friends • {pendingCount} requests</Text>
                    </View>
                </TouchableOpacity>
            </View>
            <View style={styles.statsRow}>
                <View style={styles.statCard}><Text style={styles.statNumber}>{friendsList.length}</Text><Text style={styles.statLabel}>Friends</Text></View>
                <View style={styles.statCard}><Text style={styles.statNumber}>{pendingCount}</Text><Text style={styles.statLabel}>Requests</Text></View>
                <View style={styles.statCard}><Text style={styles.statNumber}>{Object.keys(chatMessages).length}</Text><Text style={styles.statLabel}>Chats</Text></View>
            </View>
            <View style={styles.navRow}>
                <TouchableOpacity style={styles.navButton} onPress={() => { setSearchQuery(""); setScreen("home"); }}><Text style={styles.navText}>💬 Chats</Text></TouchableOpacity>
                <TouchableOpacity style={styles.navButton} onPress={() => { setSearchQuery(""); setScreen("friendRequests"); }}><Text style={styles.navText}>👥 Requests</Text></TouchableOpacity>
                <TouchableOpacity style={styles.navButton} onPress={() => { setSearchQuery(""); setScreen("findFriends"); }}><Text style={styles.navText}>🔍 Find</Text></TouchableOpacity>
            </View>
        </SafeAreaView>
    );
}

// ==================== HOME/CHATS SCREEN ====================
if (screen === "home" && currentUser) {
    const filteredFriends = friendsList.filter(f =>
        f.fullName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        f.email?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const sortedFriends = [...filteredFriends].sort((a, b) => {
        const aPinned = pinnedChatIds.includes(a.id);
        const bPinned = pinnedChatIds.includes(b.id);
        if (aPinned && !bPinned) return -1;
        if (!aPinned && bPinned) return 1;
        const aChatId = [currentUser.uid, a.id].sort().join('_');
        const bChatId = [currentUser.uid, b.id].sort().join('_');
        const aMessages = chatMessages[aChatId] || [];
        const bMessages = chatMessages[bChatId] || [];
        const aLast = aMessages[aMessages.length - 1];
        const bLast = bMessages[bMessages.length - 1];
        const aTime = aLast?.timestamp?.toDate?.()?.getTime?.() || 0;
        const bTime = bLast?.timestamp?.toDate?.()?.getTime?.() || 0;
        return bTime - aTime;
    });
    return (
        <SafeAreaView style={styles.container}>
            <StatusBar backgroundColor="#3B82F6" barStyle="light-content" />
            <View style={styles.header}>
                <TouchableOpacity onPress={goBack}><Text style={styles.backTextWhite}>← Back</Text></TouchableOpacity>
                <Text style={styles.headerTitle}>Chats</Text>
                <View style={{ width: 50 }} />
            </View>
            <View style={styles.searchBar}><TextInput style={styles.searchInput} placeholder="Search friends..." value={searchQuery} onChangeText={setSearchQuery} /></View>
            {friendsList.length === 0 ? (
                <View style={styles.emptyState}><Text style={styles.emptyText}>No friends yet</Text><TouchableOpacity onPress={() => setScreen("findFriends")}><Text style={styles.linkText}>Find friends</Text></TouchableOpacity></View>
            ) : (
                <FlatList
                    data={sortedFriends}
                    keyExtractor={item => item.id}
                    renderItem={({ item }) => {
                        const chatId = [currentUser.uid, item.id].sort().join('_');
                        const messages = chatMessages[chatId] || [];
                        const lastMsg = messages[messages.length - 1];
                        const unreadCount = messages.filter(m => m.senderId === item.id && !m.read).length;
                        const isPinned = pinnedChatIds.includes(item.id);
                        const isBlocked = isBlockedRelationship(item.id);
                        return (
                            <TouchableOpacity
                                style={[styles.chatItem, isBlocked && styles.chatItemBlocked]}
                                onPress={() => {
                                    if (isBlocked) {
                                        Alert.alert("Blocked", "This chat is unavailable because a block is active.");
                                        return;
                                    }
                                    setSelectedFriend(item);
                                    setScreen("chat");
                                }}
                                onLongPress={() => {
                                    setUserPreviewReturnScreen("home");
                                    setViewProfileUser(item);
                                    setScreen("userPreview");
                                }}
                            >
                                <View style={styles.avatarContainer}>
                                    {renderAvatar(item, styles.avatarPlaceholder, styles.avatarText, item.uid)}
                                </View>
                                <View style={styles.chatInfo}>
                                    <View style={styles.chatNameRow}>
                                        <Text style={styles.chatName}>{item.fullName}</Text>
                                        {isPinned && <Text style={styles.pinnedBadge}>📌</Text>}
                                    </View>
                                    <Text style={styles.chatPreview} numberOfLines={1}>
                                        {isBlocked
                                            ? "Blocked conversation"
                                            : lastMsg
                                                ? (lastMsg.senderId === currentUser.uid ? `You: ${lastMsg.text}` : lastMsg.text)
                                                : "Tap to start chatting"}
                                    </Text>
                                </View>
                                <View style={styles.chatRight}>
                                    {lastMsg && <Text style={styles.chatTime}>{formatTime(lastMsg.timestamp)}</Text>}
                                    {unreadCount > 0 && (
                                        <View style={styles.unreadBadge}>
                                            <Text style={styles.unreadBadgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
                                        </View>
                                    )}
                                </View>
                            </TouchableOpacity>
                        );
                    }}
                />
            )}
        </SafeAreaView>
    );
}

// ==================== CHAT SCREEN ====================
if (screen === "chat" && selectedFriend && currentUser) {
    const chatId = [currentUser.uid, selectedFriend.id].sort().join('_');
    const messages = chatMessages[chatId] || [];
    const now = Date.now();
    const visibleMessages = messages.filter((msg) => {
        const expireTime = msg.expiresAt?.toDate?.()?.getTime?.() || (msg.expiresAt ? new Date(msg.expiresAt).getTime() : null);
        return !expireTime || expireTime > now;
    });
    const sortedMessages = [...visibleMessages].sort((a, b) => (a.timestamp?.toDate?.() || 0) - (b.timestamp?.toDate?.() || 0));
    const activeTheme = CHAT_THEMES[chatTheme] || CHAT_THEMES.default;

    return (
        <SafeAreaView style={styles.container}>
            <StatusBar backgroundColor="#3B82F6" barStyle="light-content" />
            <KeyboardAvoidingView
                style={{ flex: 1 }}
                behavior={Platform.OS === "ios" ? "padding" : undefined}
                keyboardVerticalOffset={Platform.OS === "ios" ? 12 : 0}
            >
                <View style={styles.chatHeader}>
                    <TouchableOpacity onPress={goBack}><Text style={styles.backTextWhite}>← Back</Text></TouchableOpacity>
                    <TouchableOpacity
                        style={styles.chatHeaderInfo}
                        activeOpacity={0.8}
                        onPress={() => {
                            setUserPreviewReturnScreen("chat");
                            setViewProfileUser(selectedFriend);
                            setScreen("userPreview");
                        }}
                    >
                        {renderAvatar(selectedFriend, styles.chatAvatarPlaceholder, styles.chatAvatarText, selectedFriend.uid)}
                        <Text style={styles.chatHeaderName}>{selectedFriend.fullName}</Text>
                    </TouchableOpacity>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <TouchableOpacity onPress={() => initiateCall(selectedFriend)} style={{ marginRight: 15 }}>
                            <Text style={{ color: 'white', fontSize: 22 }}>📞</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={openChatMainMenu}>
                            <Text style={styles.removeIcon}>⋯</Text>
                        </TouchableOpacity>
                    </View>
                </View>
                <FlatList
                    ref={flatListRef}
                    data={sortedMessages}
                    keyExtractor={item => item.id}
                    style={styles.messagesList}
                    contentContainerStyle={styles.messagesContainer}
                    keyboardShouldPersistTaps="handled"
                    onContentSizeChange={(w, h) => {
                        if (flatListRef.current) {
                            flatListRef.current._lastContentHeight = h;
                        }
                    }}
                    onScroll={({ nativeEvent }) => {
                        if (flatListRef.current) {
                            const { contentOffset, layoutMeasurement, contentSize } = nativeEvent;
                            flatListRef.current._isNearBottom = contentSize.height - contentOffset.y - layoutMeasurement.height < 150;
                        }
                    }}
                    onLayout={() => flatListRef.current?.scrollToEnd({ animated: false })}
                    renderItem={({ item }) => {
                        const isMyMessage = item.senderId === currentUser.uid;
                        return (
                            <View style={[styles.messageRow, isMyMessage ? styles.myMessageRow : styles.theirMessageRow]}>
                                <TouchableOpacity
                                    activeOpacity={0.7}
                                    onLongPress={() => showMessageActions(item)}
                                >
                                    <View style={[
                                        styles.messageBubble,
                                        isMyMessage ? styles.myBubble : styles.theirBubble,
                                        isMyMessage ? { backgroundColor: activeTheme.myBubble } : null,
                                    ]}>
                                        <Text style={[styles.messageText, isMyMessage ? styles.myMessageText : styles.theirMessageText]}>{item.text}</Text>
                                        <View style={styles.messageFooter}>
                                            {!!item.editedAt && <Text style={[styles.editedLabel, isMyMessage && styles.myMessageMeta]}>edited</Text>}
                                            <Text style={[styles.messageTime, isMyMessage && styles.myMessageMeta]}>{formatTime(item.timestamp)}</Text>
                                            {isMyMessage && <Text style={[styles.messageStatus, styles.myMessageMeta]}>{item.read ? "✓✓" : "✓"}</Text>}
                                        </View>
                                    </View>
                                </TouchableOpacity>
                            </View>
                        );
                    }}
                />
                {editingMessage && (
                    <View style={styles.editBanner}>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.editBannerTitle}>Editing message</Text>
                            <Text style={styles.editBannerText} numberOfLines={1}>{editingMessage.text}</Text>
                        </View>
                        <TouchableOpacity onPress={cancelEditingMessage}>
                            <Text style={styles.editBannerCancel}>Cancel</Text>
                        </TouchableOpacity>
                    </View>
                )}
                <View style={styles.inputContainer}>
                    <TextInput
                        ref={messageInputRef}
                        style={styles.messageInput}
                        placeholder="Type a message..."
                        value={messageText}
                        onChangeText={setMessageText}
                        multiline
                        autoFocus
                        blurOnSubmit={false}
                        onFocus={() => flatListRef.current?.scrollToEnd({ animated: true })}
                    />
                    <TouchableOpacity style={[styles.sendButton, { backgroundColor: activeTheme.sendButton }, !messageText.trim() && styles.sendButtonDisabled]} onPress={sendMessage} disabled={!messageText.trim()}>
                        <Text style={styles.sendText}>{editingMessage ? "Save" : "Send"}</Text>
                    </TouchableOpacity>
                </View>

                <Modal visible={chatMenuVisible} transparent animationType="fade" onRequestClose={closeChatMenus}>
                    <Pressable style={styles.chatMenuOverlay} onPress={closeChatMenus}>
                        <Pressable style={styles.chatMenuPanel} onPress={() => { }}>
                            <TouchableOpacity style={styles.chatMenuItem} onPress={() => { closeChatMenus(); handleAddToContacts(); }}>
                                <Text style={styles.chatMenuItemText}>Add to contacts</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.chatMenuItem} onPress={() => { closeChatMenus(); messageInputRef.current?.focus(); }}>
                                <Text style={styles.chatMenuItemText}>Search</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.chatMenuItem} onPress={() => { closeChatMenus(); reportUser(selectedFriend.id, selectedFriend.fullName); }}>
                                <Text style={styles.chatMenuItemText}>Report</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.chatMenuItem} onPress={() => { closeChatMenus(); blockUser(selectedFriend.id, selectedFriend.fullName); }}>
                                <Text style={styles.chatMenuItemText}>Block</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.chatMenuItem} onPress={() => { closeChatMenus(); toggleChatNotifications(); }}>
                                <Text style={styles.chatMenuItemText}>{isChatMuted ? "Unmute notifications" : "Mute notifications"}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.chatMenuItem} onPress={() => { closeChatMenus(); toggleDisappearingMessages(); }}>
                                <Text style={styles.chatMenuItemText}>{disappearingHours > 0 ? "Disappearing messages (On)" : "Disappearing messages (Off)"}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.chatMenuItem} onPress={() => { closeChatMenus(); cycleChatTheme(); }}>
                                <Text style={styles.chatMenuItemText}>Chat theme ({chatTheme})</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.chatMenuItem} onPress={openChatMoreMenu}>
                                <Text style={styles.chatMenuItemText}>More</Text>
                            </TouchableOpacity>
                        </Pressable>
                    </Pressable>
                </Modal>

                <Modal visible={chatMoreMenuVisible} transparent animationType="fade" onRequestClose={closeChatMenus}>
                    <Pressable style={styles.chatMenuOverlay} onPress={closeChatMenus}>
                        <Pressable style={styles.chatMenuPanel} onPress={() => { }}>
                            <TouchableOpacity style={styles.chatMenuItem} onPress={() => { closeChatMenus(); setUserPreviewReturnScreen("chat"); setViewProfileUser(selectedFriend); setScreen("userPreview"); }}>
                                <Text style={styles.chatMenuItemText}>Media, links, and docs</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.chatMenuItem} onPress={() => { closeChatMenus(); clearChat(selectedFriend.id, selectedFriend.fullName); }}>
                                <Text style={styles.chatMenuItemText}>Clear chat</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.chatMenuItem} onPress={() => { closeChatMenus(); handleExportChat(); }}>
                                <Text style={styles.chatMenuItemText}>Export chat</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.chatMenuItem} onPress={() => { closeChatMenus(); toggleChatShortcut(); }}>
                                <Text style={styles.chatMenuItemText}>{isShortcutAdded ? "Remove shortcut" : "Add shortcut"}</Text>
                            </TouchableOpacity>
                        </Pressable>
                    </Pressable>
                </Modal>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

// ==================== FRIEND REQUESTS SCREEN ====================
if (screen === "friendRequests" && currentUser) {
    return (
        <SafeAreaView style={styles.container}>
            <StatusBar backgroundColor="#3B82F6" barStyle="light-content" />
            <View style={styles.header}>
                <TouchableOpacity onPress={goBack}><Text style={styles.backTextWhite}>← Back</Text></TouchableOpacity>
                <Text style={styles.headerTitle}>Friend Requests</Text>
                <View style={{ width: 50 }} />
            </View>
            {friendRequests.filter(r => r.to === currentUser.uid).length === 0 ? (
                <View style={styles.emptyState}><Text style={styles.emptyText}>No pending requests</Text></View>
            ) : (
                <FlatList
                    data={friendRequests.filter(r => r.to === currentUser.uid)}
                    keyExtractor={item => item.id}
                    renderItem={({ item }) => (
                        <View style={styles.requestCard}>
                            <View style={styles.requestInfo}>
                                <View style={[styles.requestAvatar, { backgroundColor: generateUserColor(item.from) }]}>
                                    <Text style={styles.avatarText}>{item.fromName?.charAt(0)}</Text>
                                </View>
                                <View style={styles.requestDetails}>
                                    <Text style={styles.requestName}>{item.fromName}</Text>
                                    <Text style={styles.requestText}>Wants to be your friend</Text>
                                </View>
                            </View>
                            <View style={styles.requestButtons}>
                                <TouchableOpacity style={styles.acceptButton} onPress={() => acceptFriendRequest(item)}><Text style={styles.acceptText}>Accept</Text></TouchableOpacity>
                                <TouchableOpacity style={styles.declineButton} onPress={() => declineFriendRequest(item.id)}><Text style={styles.declineText}>Decline</Text></TouchableOpacity>
                            </View>
                        </View>
                    )}
                />
            )}
        </SafeAreaView>
    );
}

// ==================== PROFILE SCREEN ====================
if (screen === "profile" && currentUser) {
    return (
        <SafeAreaView style={styles.container}>
            <StatusBar backgroundColor="#3B82F6" barStyle="light-content" />
            <View style={styles.header}>
                <TouchableOpacity onPress={goBack}><Text style={styles.backTextWhite}>← Back</Text></TouchableOpacity>
                <Text style={styles.headerTitle}>My Profile</Text>
                <View style={{ width: 50 }} />
            </View>
            <ScrollView>
                <View style={styles.profileHeader}>
                    <TouchableOpacity onPress={pickProfilePhoto} activeOpacity={0.8}>
                        {renderAvatar(currentUser, styles.profileImagePlaceholder, styles.profileImageText, currentUser.uid)}
                        <View style={styles.profilePhotoBadge}>
                            <Text style={styles.profilePhotoBadgeText}>✎</Text>
                        </View>
                    </TouchableOpacity>
                    {editingProfile ? (
                        <>
                            <TextInput style={styles.editInput} value={editName} onChangeText={setEditName} placeholder="Full Name" />
                            <View style={styles.editButtons}>
                                <TouchableOpacity onPress={() => setEditingProfile(false)}><Text style={styles.cancelText}>Cancel</Text></TouchableOpacity>
                                <TouchableOpacity onPress={async () => {
                                    await getFirestore().collection('users').doc(currentUser.uid).update({ fullName: editName });
                                    setCurrentUser({ ...currentUser, fullName: editName });
                                    setEditingProfile(false);
                                    Alert.alert("Success", "Profile updated");
                                }}><Text style={styles.saveText}>Save</Text></TouchableOpacity>
                            </View>
                        </>
                    ) : (
                        <>
                            <Text style={styles.profileName}>{currentUser.fullName}</Text>
                            <Text style={styles.profileUsername}>{currentUser.email}</Text>
                            <Text style={styles.profileBio}>{currentUser.bio}</Text>
                            <TouchableOpacity style={styles.editProfileButton} onPress={() => { setEditingProfile(true); setEditName(currentUser.fullName); }}>
                                <Text style={styles.editProfileText}>Edit Profile</Text>
                            </TouchableOpacity>
                        </>
                    )}
                </View>
                <View style={styles.infoSection}>
                    <Text style={styles.sectionTitle}>Account</Text>
                    <TouchableOpacity style={styles.actionButton} onPress={handleLogout}><Text style={styles.actionText}>Logout</Text></TouchableOpacity>
                    <TouchableOpacity style={[styles.actionButton, styles.deleteButton]} onPress={deleteAccount}><Text style={styles.deleteText}>Delete Account</Text></TouchableOpacity>
                </View>
                <View style={styles.infoSection}>
                    <Text style={styles.sectionTitle}>Legal</Text>
                    <TouchableOpacity style={styles.actionButton} onPress={() => setTermsModalVisible(true)}><Text style={styles.actionText}>Terms & Conditions</Text></TouchableOpacity>
                    <TouchableOpacity style={styles.actionButton} onPress={() => setPrivacyModalVisible(true)}><Text style={styles.actionText}>Privacy Policy</Text></TouchableOpacity>
                </View>
            </ScrollView>
            <Modal visible={termsModalVisible} animationType="slide" transparent={false}>
                <SafeAreaView style={styles.modalFullContainer}>
                    <View style={styles.modalFullHeader}><TouchableOpacity onPress={() => setTermsModalVisible(false)}><Text style={styles.modalFullClose}>← Back</Text></TouchableOpacity><Text style={styles.modalFullTitle}>Terms & Conditions</Text><View style={{ width: 50 }} /></View>
                    <TermsContent />
                </SafeAreaView>
            </Modal>
            <Modal visible={privacyModalVisible} animationType="slide" transparent={false}>
                <SafeAreaView style={styles.modalFullContainer}>
                    <View style={styles.modalFullHeader}><TouchableOpacity onPress={() => setPrivacyModalVisible(false)}><Text style={styles.modalFullClose}>← Back</Text></TouchableOpacity><Text style={styles.modalFullTitle}>Privacy Policy</Text><View style={{ width: 50 }} /></View>
                    <PrivacyContent />
                </SafeAreaView>
            </Modal>
        </SafeAreaView>
    );
}

// ==================== FIND FRIENDS SCREEN ====================
if (screen === "findFriends" && currentUser) {
    const isFriend = (userId) => friendsList.some(f => f.id === userId);
    const isRequestSent = (userId) => friendRequests.some(r => r.from === currentUser.uid && r.to === userId);
    const isRequestReceived = (userId) => friendRequests.some(r => r.from === userId && r.to === currentUser.uid);
    const filteredUsers = allUsers.filter((u) => {
        if (isBlockedRelationship(u.id)) {
            return false;
        }

        const lowerQuery = searchQuery.toLowerCase();
        return (
            u.fullName?.toLowerCase().includes(lowerQuery) ||
            u.email?.toLowerCase().includes(lowerQuery)
        );
    });
    return (
        <SafeAreaView style={styles.container}>
            <StatusBar backgroundColor="#3B82F6" barStyle="light-content" />
            <View style={styles.header}>
                <TouchableOpacity onPress={goBack}><Text style={styles.backTextWhite}>← Back</Text></TouchableOpacity>
                <Text style={styles.headerTitle}>Find Friends</Text>
                <View style={{ width: 50 }} />
            </View>
            <View style={styles.searchBar}><TextInput style={styles.searchInput} placeholder="Search by name or email..." value={searchQuery} onChangeText={setSearchQuery} /></View>
            <FlatList
                data={filteredUsers}
                keyExtractor={item => item.id}
                renderItem={({ item }) => (
                    <View style={styles.userCard}>
                        <TouchableOpacity style={styles.userInfo} onPress={() => { setUserPreviewReturnScreen("findFriends"); setViewProfileUser(item); setScreen("userPreview"); }}>
                            {renderAvatar(item, styles.userAvatarPlaceholder, styles.avatarText, item.id)}
                            <View>
                                <Text style={styles.userName}>{item.fullName}</Text>
                                <Text style={styles.userUsername}>{item.email}</Text>
                            </View>
                        </TouchableOpacity>
                        {isFriend(item.id) ? (
                            <Text style={styles.friendBadge}>✓ Friend</Text>
                        ) : isRequestSent(item.id) ? (
                            <Text style={styles.pendingBadge}>⏳ Pending</Text>
                        ) : isRequestReceived(item.id) ? (
                            <TouchableOpacity style={styles.acceptFriendButton} onPress={() => {
                                const request = friendRequests.find(r => r.from === item.id && r.to === currentUser.uid);
                                if (request) acceptFriendRequest(request);
                            }}><Text style={styles.acceptFriendText}>Accept</Text></TouchableOpacity>
                        ) : (
                            <TouchableOpacity style={styles.addButton} onPress={() => sendFriendRequest(item.id, item.fullName)}>
                                <Text style={styles.addButtonText}>+ Add</Text>
                            </TouchableOpacity>
                        )}
                    </View>
                )}
                ListEmptyComponent={() => (
                    <View style={styles.emptyState}>
                        {usersLoading ? (
                            <><ActivityIndicator size="large" color="#3B82F6" /><Text style={styles.emptyText}>Loading users...</Text></>
                        ) : usersError ? (
                            <><Text style={styles.emptyText}>Failed to load users</Text><TouchableOpacity onPress={() => { setUsersLoading(true); setUsersError(null); const unsub = getFirestore().collection('users').onSnapshot((snap) => { const u = []; snap.forEach(d => { if (d.id !== currentUser.uid) u.push({ id: d.id, ...d.data() }); }); setAllUsers(u); setUsersLoading(false); }, (e) => { setUsersLoading(false); setUsersError(e.message); }); setTimeout(() => unsub && unsub(), 10000); }}><Text style={styles.linkText}>Tap to retry</Text></TouchableOpacity></>
                        ) : (
                            <Text style={styles.emptyText}>No users found</Text>
                        )}
                    </View>
                )}
            />
        </SafeAreaView>
    );
}

// ==================== USER PREVIEW SCREEN ====================
if (screen === "userPreview" && viewProfileUser && currentUser) {
    const isFriend = friendsList.some(f => f.id === viewProfileUser.id);
    const chatId = [currentUser.uid, viewProfileUser.id].sort().join('_');
    const sharedMessages = chatMessages[chatId] || [];
    return (
        <SafeAreaView style={styles.container}>
            <StatusBar backgroundColor="#3B82F6" barStyle="light-content" />
            <View style={styles.header}>
                <TouchableOpacity onPress={goBack}><Text style={styles.backTextWhite}>← Back</Text></TouchableOpacity>
                <Text style={styles.headerTitle}>Contact Info</Text>
                <View style={{ width: 50 }} />
            </View>
            <ScrollView>
                {/* Profile Section */}
                <View style={styles.profileHeader}>
                    {renderAvatar(viewProfileUser, styles.contactProfileImage, styles.profileImageText, viewProfileUser.id)}
                    <Text style={styles.profileName}>{viewProfileUser.fullName}</Text>
                    <Text style={styles.profileUsername}>{viewProfileUser.email}</Text>
                    {viewProfileUser.bio ? <Text style={styles.profileBio}>{viewProfileUser.bio}</Text> : null}
                </View>

                {/* Action Buttons Row */}
                {isFriend && (
                    <View style={up.actionRow}>
                        <TouchableOpacity style={up.actionBtn} onPress={() => { setSelectedFriend(viewProfileUser); setScreen("chat"); }}>
                            <Text style={up.actionIcon}>💬</Text>
                            <Text style={up.actionLabel}>Message</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={up.actionBtn} onPress={() => initiateCall(viewProfileUser)}>
                            <Text style={up.actionIcon}>📞</Text>
                            <Text style={up.actionLabel}>Audio</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={up.actionBtn} onPress={() => { setSearchQuery(""); setSelectedFriend(viewProfileUser); setScreen("chat"); }}>
                            <Text style={up.actionIcon}>🔍</Text>
                            <Text style={up.actionLabel}>Search</Text>
                        </TouchableOpacity>
                    </View>
                )}

                {!isFriend && (
                    <View style={{ paddingHorizontal: 15, marginBottom: 10 }}>
                        <TouchableOpacity style={styles.addFriendButton} onPress={() => sendFriendRequest(viewProfileUser.id, viewProfileUser.fullName)}>
                            <Text style={styles.addFriendText}>➕ Add Friend</Text>
                        </TouchableOpacity>
                    </View>
                )}

                {/* Media & Chat Info */}
                {isFriend && (
                    <View style={up.section}>
                        <TouchableOpacity style={up.row} onPress={showMediaLinksSummary}>
                            <Text style={up.rowIcon}>🖼️</Text>
                            <Text style={up.rowText}>Media, links and docs</Text>
                            <Text style={up.rowValue}>{sharedMessages.length > 0 ? sharedMessages.length : 0}</Text>
                            <Text style={up.rowArrow}>›</Text>
                        </TouchableOpacity>
                        <View style={up.divider} />
                        <TouchableOpacity style={up.row} onPress={showStarredMessages}>
                            <Text style={up.rowIcon}>⭐</Text>
                            <Text style={up.rowText}>Starred messages</Text>
                            <Text style={up.rowValue}>None</Text>
                            <Text style={up.rowArrow}>›</Text>
                        </TouchableOpacity>
                    </View>
                )}

                {/* Chat Settings */}
                {isFriend && (
                    <View style={up.section}>
                        <TouchableOpacity style={up.row} onPress={toggleChatNotifications}>
                            <Text style={up.rowIcon}>🔔</Text>
                            <Text style={up.rowText}>Notifications</Text>
                            <Text style={up.rowValue}>{isChatMuted ? "Off" : "On"}</Text>
                            <Text style={up.rowArrow}>›</Text>
                        </TouchableOpacity>
                        <View style={up.divider} />
                        <TouchableOpacity style={up.row} onPress={showEncryptionInfo}>
                            <Text style={up.rowIcon}>🔒</Text>
                            <Text style={up.rowText}>Encryption</Text>
                            <View style={{ flex: 1 }}>
                                <Text style={up.rowSubtext}>Messages are end-to-end encrypted.</Text>
                            </View>
                            <Text style={up.rowArrow}>›</Text>
                        </TouchableOpacity>
                    </View>
                )}

                {/* Contact Details */}
                <View style={up.section}>
                    <View style={up.row}>
                        <Text style={up.rowIcon}>📧</Text>
                        <View style={{ flex: 1 }}>
                            <Text style={up.rowText}>{viewProfileUser.email}</Text>
                            <Text style={up.rowSubtext}>Email</Text>
                        </View>
                    </View>
                    {viewProfileUser.bio && (
                        <>
                            <View style={up.divider} />
                            <View style={up.row}>
                                <Text style={up.rowIcon}>📝</Text>
                                <View style={{ flex: 1 }}>
                                    <Text style={up.rowText}>{viewProfileUser.bio}</Text>
                                    <Text style={up.rowSubtext}>About</Text>
                                </View>
                            </View>
                        </>
                    )}
                </View>

                {/* Actions */}
                {isFriend && (
                    <View style={up.section}>
                        <TouchableOpacity style={up.row} onPress={() => clearChat(viewProfileUser.id, viewProfileUser.fullName)}>
                            <Text style={up.rowIcon}>🗑️</Text>
                            <Text style={[up.rowText, { color: '#ef4444' }]}>Clear chat</Text>
                        </TouchableOpacity>
                    </View>
                )}

                {/* Unfriend */}
                {isFriend && (
                    <View style={up.section}>
                        <TouchableOpacity style={up.row} onPress={() => removeFriend(viewProfileUser.id, viewProfileUser.fullName)}>
                            <Text style={up.rowIcon}>👤</Text>
                            <Text style={[up.rowText, { color: '#F59E0B' }]}>Unfriend {viewProfileUser.fullName}</Text>
                        </TouchableOpacity>
                    </View>
                )}

                {/* Block & Report */}
                <View style={up.section}>
                    <TouchableOpacity style={up.row} onPress={() => blockUser(viewProfileUser.id, viewProfileUser.fullName)}>
                        <Text style={up.rowIcon}>🚫</Text>
                        <Text style={[up.rowText, { color: '#ef4444' }]}>Block {viewProfileUser.fullName}</Text>
                    </TouchableOpacity>
                    <View style={up.divider} />
                    <TouchableOpacity style={up.row} onPress={() => reportUser(viewProfileUser.id, viewProfileUser.fullName)}>
                        <Text style={up.rowIcon}>👎</Text>
                        <Text style={[up.rowText, { color: '#ef4444' }]}>Report {viewProfileUser.fullName}</Text>
                    </TouchableOpacity>
                </View>

                <View style={{ height: 30 }} />
            </ScrollView>
        </SafeAreaView>
    );
}

// ==================== CALL SCREEN ====================
if (callState && callPartner) {
    return (
        <SafeAreaView style={styles.callContainer}>
            <StatusBar backgroundColor="#1a1a2e" barStyle="light-content" />
            <View style={styles.callContent}>
                <View style={[styles.callAvatar, { backgroundColor: generateUserColor(callPartner.id) }]}>
                    <Text style={styles.callAvatarText}>{callPartner.fullName?.charAt(0)}</Text>
                </View>
                <Text style={styles.callName}>{callPartner.fullName}</Text>
                <Text style={styles.callStatus}>
                    {callState === 'calling' ? '📞 Calling...' : callState === 'incoming' ? '📲 Incoming Call' : formatCallDuration(callDuration)}
                </Text>
                {callState === 'active' && <Text style={styles.callActiveLabel}>🔊 Connected</Text>}
            </View>
            <View style={styles.callActions}>
                {callState === 'incoming' && (
                    <View style={styles.callButtonsRow}>
                        <TouchableOpacity style={styles.declineCallBtn} onPress={declineCall}>
                            <Text style={styles.callBtnIcon}>✕</Text>
                            <Text style={styles.callBtnLabel}>Decline</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.acceptCallBtn} onPress={acceptCall}>
                            <Text style={styles.callBtnIcon}>📞</Text>
                            <Text style={styles.callBtnLabel}>Accept</Text>
                        </TouchableOpacity>
                    </View>
                )}
                {(callState === 'calling' || callState === 'active') && (
                    <View style={styles.callButtonsRow}>
                        {callState === 'active' && (
                            <TouchableOpacity style={[styles.muteCallBtn, isMuted && styles.muteCallBtnActive]} onPress={toggleMute}>
                                <Text style={styles.callBtnIcon}>{isMuted ? '🔇' : '🎙️'}</Text>
                                <Text style={styles.callBtnLabel}>{isMuted ? 'Unmute' : 'Mute'}</Text>
                            </TouchableOpacity>
                        )}
                        <TouchableOpacity style={styles.endCallBtn} onPress={endCall}>
                            <Text style={styles.callBtnIcon}>✕</Text>
                            <Text style={styles.callBtnLabel}>End Call</Text>
                        </TouchableOpacity>
                    </View>
                )}
            </View>
        </SafeAreaView>
    );
}

return null;
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: "#f5f5f5" },
    loadingContainer: { flex: 1, justifyContent: "center", alignItems: "center" },
    loadingText: { marginTop: 10, fontSize: 16, color: "#666" },
    scrollContainer: { flexGrow: 1, justifyContent: "center", padding: 20 },
    backButton: { position: "absolute", top: 50, left: 20, zIndex: 1 },
    backTextWhite: { fontSize: 16, color: "#FFFFFF", fontWeight: "600" },
    loginContainer: { backgroundColor: "white", borderRadius: 24, padding: 28, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 8, elevation: 5 },
    registerContainer: { backgroundColor: "white", borderRadius: 24, padding: 28, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 8, elevation: 5 },
    logo: { fontSize: 62, textAlign: "center", marginBottom: 10 },
    title: { fontSize: 30, fontWeight: "800", color: "#3B82F6", textAlign: "center", marginBottom: 8 },
    subtitle: { fontSize: 15, color: "#666", textAlign: "center", marginBottom: 28 },
    input: { borderWidth: 1, borderColor: "#ddd", borderRadius: 16, padding: 14, fontSize: 16, marginBottom: 15, backgroundColor: "#fff" },
    editInput: { borderWidth: 1, borderColor: "#ddd", borderRadius: 10, padding: 12, fontSize: 16, marginTop: 15, width: "80%" },
    button: { backgroundColor: "#3B82F6", padding: 16, borderRadius: 16, alignItems: "center", marginBottom: 15 },
    buttonDisabled: { backgroundColor: "#93C5FD" },
    buttonText: { color: "white", fontSize: 16, fontWeight: "bold" },
    linkText: { color: "#6366F1", fontSize: 14, textAlign: "center", marginTop: 10, fontWeight: "600" },
    linkTextInline: { color: "#6366F1", fontSize: 14, fontWeight: "600" },
    footerLinks: { flexDirection: "row", justifyContent: "center", marginTop: 20 },
    footerLinkText: { color: "#666", fontSize: 12 },
    footerLinkSeparator: { color: "#666", marginHorizontal: 10 },
    checkboxRow: { flexDirection: "row", alignItems: "center", marginBottom: 20, flexWrap: "wrap" },
    checkbox: { marginRight: 8 },
    checkboxText: { fontSize: 20 },
    checkboxLabel: { fontSize: 14, color: "#666" },
    dashboardHeader: { backgroundColor: "#3B82F6", padding: 20, paddingTop: 50, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    profileButton: { flexDirection: "row", alignItems: "center", flex: 1 },
    headerAvatarPlaceholder: { width: 50, height: 50, borderRadius: 25, justifyContent: "center", alignItems: "center", marginRight: 12 },
    headerAvatarText: { color: "white", fontSize: 20, fontWeight: "bold" },
    avatarImage: { backgroundColor: "#e5e7eb" },
    welcomeText: { color: "white", fontSize: 18, fontWeight: "bold" },
    statsText: { color: "rgba(255,255,255,0.9)", fontSize: 12, marginTop: 2 },
    logoutText: { color: "white", fontSize: 14, fontWeight: "600" },
    statsRow: { flexDirection: "row", justifyContent: "space-around", padding: 20, backgroundColor: "white", margin: 15, borderRadius: 20 },
    statCard: { alignItems: "center" },
    statNumber: { fontSize: 24, fontWeight: "bold", color: "#3B82F6" },
    statLabel: { fontSize: 12, color: "#666", marginTop: 5 },
    navRow: { flexDirection: "row", justifyContent: "space-around", padding: 18, backgroundColor: "white", marginHorizontal: 15, borderRadius: 20, marginBottom: 15 },
    navButton: { alignItems: "center", padding: 10 },
    navText: { fontSize: 14, color: "#333", fontWeight: "600" },
    header: { backgroundColor: "#3B82F6", padding: 18, paddingTop: 54, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    headerTitle: { color: "white", fontSize: 18, fontWeight: "700" },
    searchBar: { backgroundColor: "white", padding: 12, borderBottomWidth: 1, borderBottomColor: "#eee" },
    searchInput: { backgroundColor: "#f3f4f6", padding: 12, borderRadius: 16, fontSize: 16 },
    chatItem: { flexDirection: "row", alignItems: "center", backgroundColor: "white", padding: 16, borderRadius: 20, marginHorizontal: 15, marginVertical: 6, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 2 },
    chatItemBlocked: { opacity: 0.5 },
    avatarContainer: { marginRight: 15 },
    avatarPlaceholder: { width: 55, height: 55, borderRadius: 28, justifyContent: "center", alignItems: "center" },
    avatarText: { color: "white", fontSize: 24, fontWeight: "bold" },
    chatInfo: { flex: 1 },
    chatNameRow: { flexDirection: "row", alignItems: "center" },
    chatName: { fontSize: 16, fontWeight: "bold", marginBottom: 4 },
    pinnedBadge: { marginLeft: 6, fontSize: 12 },
    chatPreview: { fontSize: 14, color: "#666" },
    chatRight: { alignItems: "flex-end" },
    chatTime: { fontSize: 11, color: "#999", marginBottom: 4 },
    unreadBadge: { backgroundColor: "#3B82F6", borderRadius: 12, minWidth: 22, height: 22, alignItems: "center", justifyContent: "center", paddingHorizontal: 6, marginTop: 4 },
    unreadBadgeText: { color: "white", fontSize: 11, fontWeight: "bold" },
    emptyState: { flex: 1, justifyContent: "center", alignItems: "center", padding: 50 },
    emptyText: { fontSize: 16, color: "#999", marginBottom: 10 },
    chatHeader: { backgroundColor: "#3B82F6", padding: 18, paddingTop: 54, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    chatHeaderInfo: { flexDirection: "row", alignItems: "center", flex: 1, marginLeft: 10 },
    chatAvatarPlaceholder: { width: 40, height: 40, borderRadius: 20, justifyContent: "center", alignItems: "center" },
    chatAvatarText: { color: "white", fontSize: 18, fontWeight: "bold" },
    chatHeaderName: { color: "white", fontSize: 16, fontWeight: "bold", marginLeft: 10 },
    removeIcon: { color: "white", fontSize: 20, fontWeight: "bold", padding: 5 },
    chatMenuOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.15)", justifyContent: "flex-start", alignItems: "flex-end", paddingTop: 95, paddingRight: 14 },
    chatMenuPanel: { backgroundColor: "white", borderRadius: 16, minWidth: 245, paddingVertical: 6, shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 10, elevation: 8 },
    chatMenuItem: { paddingHorizontal: 20, paddingVertical: 14 },
    chatMenuItemText: { fontSize: 18, color: "#111827" },
    messagesList: { flex: 1 },
    messagesContainer: { padding: 15 },
    messageRow: { marginBottom: 15, alignItems: "flex-end" },
    myMessageRow: { alignItems: "flex-end" },
    theirMessageRow: { alignItems: "flex-start" },
    messageBubble: { maxWidth: "75%", padding: 12, borderRadius: 18 },
    myBubble: { backgroundColor: "#3B82F6", borderBottomRightRadius: 4 },
    theirBubble: { backgroundColor: "#e5e5ea", borderBottomLeftRadius: 4 },
    messageText: { fontSize: 16 },
    myMessageText: { color: "white" },
    theirMessageText: { color: "#000" },
    messageFooter: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", marginTop: 4 },
    editedLabel: { fontSize: 10, color: "rgba(0,0,0,0.5)", marginRight: 6 },
    messageTime: { fontSize: 10, color: "rgba(0,0,0,0.5)", marginRight: 4 },
    messageStatus: { fontSize: 10, color: "rgba(0,0,0,0.5)" },
    myMessageMeta: { color: "rgba(255,255,255,0.7)" },
    editBanner: { flexDirection: "row", alignItems: "center", paddingHorizontal: 15, paddingVertical: 10, backgroundColor: "#eff6ff", borderTopWidth: 1, borderTopColor: "#dbeafe" },
    editBannerTitle: { fontSize: 13, fontWeight: "700", color: "#2563eb", marginBottom: 2 },
    editBannerText: { fontSize: 12, color: "#4b5563" },
    editBannerCancel: { fontSize: 13, fontWeight: "700", color: "#ef4444", marginLeft: 12 },
    inputContainer: { flexDirection: "row", padding: 15, backgroundColor: "white", borderTopWidth: 1, borderTopColor: "#eee", alignItems: "center" },
    messageInput: { flex: 1, backgroundColor: "#f3f4f6", borderRadius: 24, paddingHorizontal: 18, paddingVertical: 10, fontSize: 16, maxHeight: 100 },
    sendButton: { backgroundColor: "#3B82F6", borderRadius: 24, paddingHorizontal: 22, paddingVertical: 10, marginLeft: 10 },
    sendButtonDisabled: { backgroundColor: "#ccc" },
    sendText: { color: "white", fontWeight: "bold" },
    requestCard: { backgroundColor: "white", margin: 15, padding: 18, borderRadius: 18, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 2 },
    requestInfo: { flexDirection: "row", alignItems: "center", marginBottom: 15 },
    requestAvatar: { width: 50, height: 50, borderRadius: 25, justifyContent: "center", alignItems: "center", marginRight: 15 },
    requestDetails: { flex: 1 },
    requestName: { fontSize: 16, fontWeight: "bold", marginBottom: 4 },
    requestText: { fontSize: 14, color: "#666" },
    requestButtons: { flexDirection: "row", justifyContent: "space-between" },
    acceptButton: { flex: 1, backgroundColor: "#10B981", padding: 12, borderRadius: 8, alignItems: "center", marginRight: 8 },
    acceptText: { color: "white", fontWeight: "bold" },
    declineButton: { flex: 1, backgroundColor: "#f0f0f0", padding: 12, borderRadius: 8, alignItems: "center", marginLeft: 8 },
    declineText: { color: "#666", fontWeight: "bold" },
    profileHeader: { backgroundColor: "white", alignItems: "center", padding: 30, marginBottom: 15 },
    profileImagePlaceholder: { width: 100, height: 100, borderRadius: 50, justifyContent: "center", alignItems: "center", marginBottom: 15 },
    profileImageText: { color: "white", fontSize: 48, fontWeight: "bold" },
    contactProfileImage: { width: 140, height: 140, borderRadius: 70, justifyContent: "center", alignItems: "center", marginBottom: 18, borderWidth: 1, borderColor: "#d1d5db" },
    profileName: { fontSize: 24, fontWeight: "bold", marginTop: 10 },
    profileUsername: { fontSize: 16, color: "#666", marginTop: 5 },
    profileBio: { fontSize: 14, color: "#666", marginTop: 10, textAlign: "center" },
    editProfileButton: { marginTop: 15, padding: 10, backgroundColor: "#3B82F6", borderRadius: 20 },
    editProfileText: { color: "white", fontWeight: "bold" },
    profilePhotoBadge: { position: "absolute", right: 0, bottom: 12, width: 32, height: 32, borderRadius: 16, backgroundColor: "#22c55e", alignItems: "center", justifyContent: "center", borderWidth: 3, borderColor: "white" },
    profilePhotoBadgeText: { color: "white", fontSize: 14, fontWeight: "bold" },
    editButtons: { flexDirection: "row", justifyContent: "center", marginTop: 10 },
    cancelText: { color: "#666", fontSize: 16, marginRight: 20 },
    saveText: { color: "#3B82F6", fontSize: 16, fontWeight: "bold" },
    infoSection: { backgroundColor: "white", margin: 15, marginTop: 0, padding: 20, borderRadius: 18 },
    sectionTitle: { fontSize: 18, fontWeight: "bold", marginBottom: 15, color: "#333" },
    actionButton: { paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: "#f0f0f0" },
    actionText: { fontSize: 16, color: "#3B82F6" },
    deleteButton: { borderBottomWidth: 0 },
    deleteText: { fontSize: 16, color: "#ef4444" },
    userCard: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: "white", margin: 15, padding: 16, borderRadius: 18, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 2 },
    userInfo: { flexDirection: "row", alignItems: "center", flex: 1 },
    userAvatarPlaceholder: { width: 50, height: 50, borderRadius: 25, justifyContent: "center", alignItems: "center", marginRight: 15 },
    userName: { fontSize: 16, fontWeight: "bold" },
    userUsername: { fontSize: 12, color: "#666", marginTop: 2 },
    friendBadge: { color: "#10B981", fontWeight: "bold" },
    pendingBadge: { color: "#F59E0B", fontWeight: "bold" },
    addButton: { backgroundColor: "#3B82F6", paddingHorizontal: 20, paddingVertical: 8, borderRadius: 20 },
    addButtonText: { color: "white", fontWeight: "bold" },
    acceptFriendButton: { backgroundColor: "#10B981", paddingHorizontal: 20, paddingVertical: 8, borderRadius: 20 },
    acceptFriendText: { color: "white", fontWeight: "bold" },
    messageButton: { backgroundColor: "#3B82F6", marginHorizontal: 15, marginBottom: 15, borderRadius: 16, alignItems: "center", padding: 15 },
    messageButtonText: { color: "white", fontSize: 16, fontWeight: "bold" },
    removeFriendButton: { backgroundColor: "#F59E0B", marginHorizontal: 15, marginBottom: 15, borderRadius: 16, alignItems: "center", padding: 15 },
    removeFriendText: { color: "white", fontSize: 16, fontWeight: "bold" },
    addFriendButton: { backgroundColor: "#3B82F6", marginHorizontal: 15, marginBottom: 15, borderRadius: 16, alignItems: "center", padding: 15 },
    addFriendText: { color: "white", fontSize: 16, fontWeight: "bold" },
    errorContainer: { flex: 1, justifyContent: "center", alignItems: "center", padding: 30 },
    errorTitle: { fontSize: 22, fontWeight: "bold", color: "#ef4444", marginBottom: 15, textAlign: "center" },
    errorText: { fontSize: 16, color: "#333", textAlign: "center", marginBottom: 20, lineHeight: 24 },
    modalFullContainer: { flex: 1, backgroundColor: "white" },
    modalFullHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 15, paddingTop: 50, backgroundColor: "#3B82F6" },
    modalFullClose: { fontSize: 16, color: "white", fontWeight: "bold" },
    modalFullTitle: { fontSize: 18, fontWeight: "bold", color: "white" },
    termsContainer: { padding: 20, backgroundColor: "white" },
    termsTitle: { fontSize: 24, fontWeight: "bold", color: "#3B82F6", marginBottom: 20, textAlign: "center" },
    termsHeading: { fontSize: 18, fontWeight: "bold", marginTop: 15, marginBottom: 10, color: "#333" },
    termsText: { fontSize: 14, color: "#666", marginBottom: 10, lineHeight: 22 },
    // Call Styles
    callContainer: { flex: 1, backgroundColor: "#1a1a2e", justifyContent: "space-between" },
    callContent: { flex: 1, justifyContent: "center", alignItems: "center", paddingTop: 60 },
    callAvatar: { width: 120, height: 120, borderRadius: 60, justifyContent: "center", alignItems: "center", marginBottom: 25 },
    callAvatarText: { color: "white", fontSize: 52, fontWeight: "bold" },
    callName: { color: "white", fontSize: 28, fontWeight: "bold", marginBottom: 10 },
    callStatus: { color: "rgba(255,255,255,0.7)", fontSize: 18, marginBottom: 5 },
    callActiveLabel: { color: "#4CAF50", fontSize: 14, fontWeight: "600", marginTop: 5 },
    callActions: { paddingBottom: 60, alignItems: "center" },
    callButtonsRow: { flexDirection: "row", justifyContent: "center", width: "100%" },
    declineCallBtn: { backgroundColor: "#ef4444", width: 75, height: 75, borderRadius: 38, justifyContent: "center", alignItems: "center", marginHorizontal: 30 },
    acceptCallBtn: { backgroundColor: "#22c55e", width: 75, height: 75, borderRadius: 38, justifyContent: "center", alignItems: "center", marginHorizontal: 30 },
    endCallBtn: { backgroundColor: "#ef4444", width: 75, height: 75, borderRadius: 38, justifyContent: "center", alignItems: "center", marginHorizontal: 15 },
    muteCallBtn: { backgroundColor: "#444", width: 65, height: 65, borderRadius: 33, justifyContent: "center", alignItems: "center", marginHorizontal: 15 },
    muteCallBtnActive: { backgroundColor: "#F59E0B" },
    callBtnIcon: { color: "white", fontSize: 28, fontWeight: "bold" },
    callBtnLabel: { color: "white", fontSize: 11, marginTop: 3, fontWeight: "600" },
});

// User Preview styles
const up = StyleSheet.create({
    actionRow: { flexDirection: "row", justifyContent: "space-around", backgroundColor: "white", marginHorizontal: 15, marginBottom: 10, borderRadius: 16, paddingVertical: 15 },
    actionBtn: { alignItems: "center", minWidth: 80 },
    actionIcon: { fontSize: 24, marginBottom: 5 },
    actionLabel: { fontSize: 13, color: "#3B82F6", fontWeight: "600" },
    section: { backgroundColor: "white", marginHorizontal: 15, marginBottom: 10, borderRadius: 16, overflow: "hidden" },
    row: { flexDirection: "row", alignItems: "center", padding: 16 },
    rowIcon: { fontSize: 20, marginRight: 15, width: 28, textAlign: "center" },
    rowText: { fontSize: 16, color: "#333", flex: 1 },
    rowSubtext: { fontSize: 13, color: "#999", marginTop: 2 },
    rowValue: { fontSize: 14, color: "#999", marginRight: 5 },
    rowArrow: { fontSize: 22, color: "#ccc", fontWeight: "300" },
    divider: { height: 1, backgroundColor: "#f0f0f0", marginLeft: 60 },
});
