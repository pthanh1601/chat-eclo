import React, {useEffect, useMemo, useState} from 'react';
import {Alert} from 'react-native';
import {DarkTheme, DefaultTheme, getFocusedRouteNameFromRoute, NavigationContainer} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {createNativeBottomTabNavigator} from '@bottom-tabs/react-navigation';
import {useSession} from '../context/SessionContext';
import {StartupScreen} from '../screens/StartupScreen';
import {LoginScreen} from '../screens/auth/LoginScreen';
import {RegisterScreen} from '../screens/auth/RegisterScreen';
import {ForgotPasswordScreen} from '../screens/auth/ForgotPasswordScreen';
import {OnboardingScreen} from '../screens/auth/OnboardingScreen';
import {ChatsScreen} from '../screens/main/ChatsScreen';
import {ContactsScreen} from '../screens/main/ContactsScreen';
import {GroupsScreen} from '../screens/main/GroupsScreen';
import {SettingsScreen} from '../screens/main/SettingsScreen';
import {ChatScreen} from '../screens/chat/ChatScreen';
import {PollComposerScreen} from '../screens/chat/PollComposerScreen';
import {MediaViewerScreen, PollDetailsScreen, RoomEditScreen, RoomFilesScreen, RoomInfoScreen, RoomInviteMembersScreen, RoomMediaScreen, RoomMembersScreen, RoomPinnedScreen, RoomPollsScreen, RoomSearchScreen} from '../screens/chat/RoomInfoScreen';
import {
  AddFriendScreen,
  ContactRequestsScreen,
  CreateGroupScreen,
  ForwardMessageScreen,
  GroupRequestsScreen,
  JoinRoomScreen,
  NewChatScreen,
  NewGroupScreen,
} from '../screens/actions/ActionScreens';
import {useAppTheme} from '../theme/useAppTheme';
import {matrixClientService} from '../core/matrix/MatrixClientService';
import {RoomService} from '../core/matrix/RoomService';
import {nativeMatrixService} from '../core/matrix/NativeMatrixService';
import {callService, type CallMediaType} from '../core/call/CallService';

export type RootStackParamList = {
  AuthWelcome: undefined;
  AuthLogin: {username?: string; notice?: string} | undefined;
  AuthRegister: undefined;
  AuthForgotPassword: undefined;
  MainTabs: undefined;
  Chat: {roomId?: string; title?: string; pendingDirectUserId?: string; jumpToEventId?: string};
  PollComposer: {roomId: string; title?: string};
  RoomInfo: {roomId: string; title?: string};
  RoomMembers: {roomId: string; title?: string};
  RoomInviteMembers: {roomId: string; title?: string};
  RoomEdit: {roomId: string; title?: string};
  RoomMedia: {roomId: string; title?: string};
  RoomFiles: {roomId: string; title?: string};
  RoomPolls: {roomId: string; title?: string};
  PollDetails: {roomId: string; pollId: string; title?: string};
  RoomSearch: {roomId: string; title?: string};
  RoomPinned: {roomId: string; title?: string};
  MediaViewer: {roomId: string; title?: string; mediaId?: string};
  ForwardMessage: {sourceRoomId: string; eventId: string};
  NewChat: undefined;
  NewGroup: undefined;
  AddFriend: undefined;
  CreateGroup: undefined;
  JoinRoom: {kind?: 'room' | 'group'} | undefined;
  ContactRequests: {initialTab?: 'incoming' | 'outgoing'} | undefined;
  GroupRequests: undefined;
};

export type MainTabParamList = {
  Chats: undefined;
  Contacts: {openAdd?: boolean} | undefined;
  Groups: undefined;
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createNativeBottomTabNavigator<MainTabParamList>();

function MainTabs() {
  const colors = useAppTheme();
  const {state} = useSession();
  const [contactBadge, setContactBadge] = useState(0);
  const [groupBadge, setGroupBadge] = useState(0);

  useEffect(() => {
    if (state.status !== 'signed_in') {
      setContactBadge(0);
      setGroupBadge(0);
      return;
    }

    const refreshBadge = () => {
      try {
        if (nativeMatrixService.isActive()) {
          Promise.all([
            nativeMatrixService.listContactRequests(),
            nativeMatrixService.listGroupInvites(),
          ])
            .then(([contactRequests, groupRequests]) => {
              setContactBadge(contactRequests.length);
              setGroupBadge(groupRequests.length);
            })
            .catch(() => {
              setContactBadge(0);
              setGroupBadge(0);
            });
          return;
        }
        const service = new RoomService(matrixClientService.currentClient);
        setContactBadge(service.listContactRequests().length);
        setGroupBadge(service.listGroupInvites().length);
      } catch {
        setContactBadge(0);
        setGroupBadge(0);
      }
    };

    refreshBadge();
    if (nativeMatrixService.isActive()) {
      return nativeMatrixService.subscribeRooms(refreshBadge);
    }

    const client = matrixClientService.currentClient;
    (client as any).on('Room', refreshBadge);
    (client as any).on('Room.myMembership', refreshBadge);
    return () => {
      (client as any).removeListener('Room', refreshBadge);
      (client as any).removeListener('Room.myMembership', refreshBadge);
    };
  }, [state]);

  return (
    <Tabs.Navigator
      key={colors.dark ? 'tabs-dark' : 'tabs-light'}
      hapticFeedbackEnabled
      labeled
      minimizeBehavior="automatic"
      scrollEdgeAppearance="default"
      translucent
      tabBarActiveTintColor={colors.primary}
      tabBarInactiveTintColor={colors.tertiaryText}
      screenOptions={{
        sceneStyle: {backgroundColor: colors.background},
      }}>
      <Tabs.Screen
        name="Chats"
        component={ChatsScreen}
        options={{
          title: 'Tin nhắn',
          tabBarLabel: 'Tin nhắn',
          tabBarIcon: ({focused}) => ({sfSymbol: focused ? 'message.fill' : 'message'}) as any,
        }}
      />
      <Tabs.Screen
        name="Contacts"
        component={ContactsScreen}
        options={{
          title: 'Danh bạ',
          tabBarLabel: 'Danh bạ',
          tabBarBadge: contactBadge ? String(contactBadge) : undefined,
          tabBarIcon: ({focused}) => ({sfSymbol: focused ? 'person.crop.circle.fill' : 'person.crop.circle'}) as any,
        }}
      />
      <Tabs.Screen
        name="Groups"
        component={GroupsScreen}
        options={{
          title: 'Nhóm',
          tabBarLabel: 'Nhóm',
          tabBarBadge: groupBadge ? String(groupBadge) : undefined,
          tabBarIcon: ({focused}) => ({sfSymbol: focused ? 'person.2.fill' : 'person.2'}) as any,
        }}
      />
      <Tabs.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          title: 'Cài đặt',
          tabBarLabel: 'Cài đặt',
          tabBarIcon: ({focused}) => ({sfSymbol: focused ? 'gearshape.fill' : 'gearshape'}) as any,
        }}
      />
    </Tabs.Navigator>
  );
}

export function RootNavigator() {
  const {state} = useSession();
  const colors = useAppTheme();
  const navigationTheme = useMemo(() => ({
    ...(colors.dark ? DarkTheme : DefaultTheme),
    dark: colors.dark,
    colors: {
      ...(colors.dark ? DarkTheme.colors : DefaultTheme.colors),
      primary: colors.primary,
      background: colors.background,
      card: colors.background,
      text: colors.text,
      border: colors.separator,
      notification: colors.primary,
    },
  }), [colors.background, colors.dark, colors.primary, colors.separator, colors.text]);
  const transparentPageOptions = {
    headerTransparent: true,
    headerStyle: {backgroundColor: 'transparent'},
    headerBackground: () => null,
    headerTitleAlign: 'center' as const,
    headerTitleStyle: {color: colors.text, fontSize: 18, fontWeight: '800' as const},
    headerShadowVisible: false,
  };

  if (state.status === 'checking') {
    return <StartupScreen boot={state.boot} />;
  }

  return (
    <NavigationContainer theme={navigationTheme}>
      <Stack.Navigator
        screenOptions={{
          headerStyle: {backgroundColor: colors.background},
          headerTitleStyle: {color: colors.text},
          headerTintColor: colors.primary,
          headerShadowVisible: false,
          headerBackButtonDisplayMode: 'minimal',
          headerBackTitle: '',
          contentStyle: {backgroundColor: colors.background},
        }}>
        {state.status === 'signed_out' ? (
          <>
            <Stack.Screen name="AuthWelcome" component={OnboardingScreen} options={{headerShown: false}} />
            <Stack.Screen name="AuthLogin" component={LoginScreen} options={{headerShown: false}} />
            <Stack.Screen name="AuthRegister" component={RegisterScreen} options={{headerShown: false}} />
            <Stack.Screen name="AuthForgotPassword" component={ForgotPasswordScreen} options={{headerShown: false}} />
          </>
        ) : (
          <>
            <Stack.Screen
              name="MainTabs"
              component={MainTabs}
              options={({route}) => {
                const routeName = getFocusedRouteNameFromRoute(route);
                return {
                  title: titleForMainTab(routeName),
                  headerShown: routeName !== 'Settings',
                  headerTransparent: true,
                  headerStyle: {backgroundColor: 'transparent'},
                  headerBackground: () => null,
                  headerTitleAlign: 'center',
                  headerTitleStyle: {color: colors.text, fontSize: 18, fontWeight: '800'},
                  headerShadowVisible: false,
                  headerBackVisible: false,
                };
              }}
            />
            <Stack.Screen
              name="Chat"
              component={ChatScreen}
              options={({navigation, route}) => ({
                title: route.params.title ?? 'Chat',
                headerTransparent: true,
                headerStyle: {backgroundColor: 'transparent'},
                headerBackground: () => null,
                headerShadowVisible: false,
                headerBackVisible: false,
                headerTitleAlign: 'center',
                headerTitleStyle: {color: colors.text, fontSize: 18, fontWeight: '900'},
                unstable_headerLeftItems: () => [
                  {
                    type: 'button',
                    label: 'Quay lại',
                    icon: {type: 'sfSymbol', name: 'chevron.left'},
                    onPress: navigation.goBack,
                    tintColor: colors.text,
                    sharesBackground: false,
                    identifier: 'chat-back',
                  },
                ],
                unstable_headerRightItems: () => [
                  {
                    type: 'button',
                    label: 'Gọi thoại',
                    icon: {type: 'sfSymbol', name: 'phone'},
                    onPress: () => startDirectCall(route.params.roomId, 'voice'),
                    tintColor: colors.text,
                    sharesBackground: false,
                    identifier: 'chat-call',
                  },
                  {
                    type: 'button',
                    label: 'Gọi video',
                    icon: {type: 'sfSymbol', name: 'video'},
                    onPress: () => startDirectCall(route.params.roomId, 'video'),
                    tintColor: colors.text,
                    sharesBackground: false,
                    identifier: 'chat-video',
                  },
                  {
                    type: 'button',
                    label: 'Thông tin',
                    icon: {type: 'sfSymbol', name: 'info.circle'},
                    onPress: () => {
                      if (route.params.roomId) {
                        navigation.navigate('RoomInfo', {roomId: route.params.roomId, title: route.params.title});
                      }
                    },
                    tintColor: colors.text,
                    sharesBackground: false,
                    identifier: 'chat-info',
                  },
                ],
              })}
            />
            <Stack.Screen name="PollComposer" component={PollComposerScreen} options={{...transparentPageOptions, title: 'Tạo bình chọn'}} />
            <Stack.Screen name="RoomInfo" component={RoomInfoScreen} options={({route}) => ({...transparentPageOptions, title: route.params.title ?? 'Thông tin'})} />
            <Stack.Screen name="RoomMembers" component={RoomMembersScreen} options={{...transparentPageOptions, title: 'Thành viên'}} />
            <Stack.Screen name="RoomInviteMembers" component={RoomInviteMembersScreen} options={{...transparentPageOptions, title: 'Thêm thành viên'}} />
            <Stack.Screen name="RoomEdit" component={RoomEditScreen} options={{...transparentPageOptions, title: 'Chỉnh nhóm'}} />
            <Stack.Screen name="RoomMedia" component={RoomMediaScreen} options={{...transparentPageOptions, title: 'Ảnh & video'}} />
            <Stack.Screen name="RoomFiles" component={RoomFilesScreen} options={{...transparentPageOptions, title: 'File đã gửi'}} />
            <Stack.Screen name="RoomPolls" component={RoomPollsScreen} options={{...transparentPageOptions, title: 'Bình chọn'}} />
            <Stack.Screen name="PollDetails" component={PollDetailsScreen} options={{...transparentPageOptions, title: 'Chi tiết bình chọn'}} />
            <Stack.Screen name="RoomSearch" component={RoomSearchScreen} options={{...transparentPageOptions, title: 'Tìm kiếm'}} />
            <Stack.Screen name="RoomPinned" component={RoomPinnedScreen} options={{...transparentPageOptions, title: 'Tin nhắn ghim'}} />
            <Stack.Screen name="MediaViewer" component={MediaViewerScreen} options={{headerShown: false}} />
            <Stack.Screen name="ForwardMessage" component={ForwardMessageScreen} options={{...transparentPageOptions, title: 'Chuyển tiếp'}} />
            <Stack.Screen name="NewChat" component={NewChatScreen} options={{...transparentPageOptions, title: 'Tạo mới'}} />
            <Stack.Screen name="NewGroup" component={NewGroupScreen} options={{...transparentPageOptions, title: 'Nhóm'}} />
            <Stack.Screen name="AddFriend" component={AddFriendScreen} options={{...transparentPageOptions, title: 'Thêm bạn'}} />
            <Stack.Screen name="CreateGroup" component={CreateGroupScreen} options={{...transparentPageOptions, title: 'Tạo nhóm'}} />
            <Stack.Screen name="JoinRoom" component={JoinRoomScreen} options={({route}) => ({...transparentPageOptions, title: route.params?.kind === 'group' ? 'Tham gia nhóm' : 'Tham gia phòng'})} />
            <Stack.Screen name="ContactRequests" component={ContactRequestsScreen} options={{...transparentPageOptions, title: 'Yêu cầu kết bạn'}} />
            <Stack.Screen name="GroupRequests" component={GroupRequestsScreen} options={{...transparentPageOptions, title: 'Yêu cầu vào nhóm'}} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

function startDirectCall(roomId: string | undefined, mediaType: CallMediaType): void {
  if (!roomId) {
    Alert.alert('Chưa thể gọi', 'Hãy gửi tin nhắn đầu tiên để tạo hội thoại trước khi gọi.');
    return;
  }
  callService.placeCall(roomId, mediaType).catch(error => {
    const message = error instanceof Error ? error.message : 'Không thể thực hiện cuộc gọi.';
    Alert.alert(mediaType === 'video' ? 'Lỗi gọi video' : 'Lỗi gọi thoại', message);
  });
}

function titleForMainTab(routeName?: string) {
  switch (routeName) {
    case 'Contacts':
      return 'Danh bạ';
    case 'Groups':
      return 'Nhóm';
    case 'Settings':
      return 'Cài đặt';
    case 'Chats':
    default:
      return 'Tin nhắn';
  }
}
