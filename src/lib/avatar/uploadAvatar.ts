import * as ImagePicker from 'expo-image-picker';
import { Alert, Linking } from 'react-native';
import { ApiClient } from '../../repos/http/ApiClient';
import { Result } from '../../types/Result';
import { showPermissionRationale } from '../../components/overlay/PermissionRationaleModal';

type UploadResponse = {
  url: string;
  key: string;
  size: number;
  mimeType: string;
};

const PICKER_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  // 不用 allowsEditing：华为 EMUI / 小米 MIUI 等定制系统的裁切 Activity 在
  // expo-image-picker 调用下经常无法 setResult() 回调，导致点"裁切"无反应、
  // 卡死回不到 App。改在 App 层用 expo-image-manipulator 或纯 CSS center-crop
  // 处理头像方形显示。
  allowsEditing: false,
  quality: 0.85,
  exif: false,
};

// 引导用户去系统设置（已永久拒绝权限的兜底）
function promptOpenSettings(permLabel: string, featureLabel: string) {
  Alert.alert(
    `需要${permLabel}权限`,
    `${featureLabel}需要使用${permLabel}权限。\n您之前已拒绝授权，请前往系统设置手动开启。`,
    [
      { text: '取消', style: 'cancel' },
      { text: '去设置', onPress: () => { Linking.openSettings().catch(() => {}); } },
    ],
  );
}

async function ensureLibraryPermission(): Promise<boolean> {
  const { status, canAskAgain } = await ImagePicker.getMediaLibraryPermissionsAsync();
  if (status === 'granted') return true;
  if (canAskAgain) {
    // 华为合规：申请系统权限前先展示自定义说明弹窗
    const userAgreed = await showPermissionRationale({
      permission: 'photoLibrary',
      featureName: '选择头像图片',
      purpose: '从您的相册中选择一张图片作为头像，用于个人资料展示',
    });
    if (!userAgreed) return false;
    const res = await ImagePicker.requestMediaLibraryPermissionsAsync();
    return res.status === 'granted';
  }
  promptOpenSettings('相册', '选择头像图片');
  return false;
}

async function ensureCameraPermission(): Promise<boolean> {
  const { status, canAskAgain } = await ImagePicker.getCameraPermissionsAsync();
  if (status === 'granted') return true;
  if (canAskAgain) {
    // 华为合规：申请系统权限前先展示自定义说明弹窗
    const userAgreed = await showPermissionRationale({
      permission: 'camera',
      featureName: '拍摄头像',
      purpose: '使用相机拍摄一张照片作为头像，用于个人资料展示',
    });
    if (!userAgreed) return false;
    const res = await ImagePicker.requestCameraPermissionsAsync();
    return res.status === 'granted';
  }
  promptOpenSettings('相机', '拍摄头像');
  return false;
}

function deriveFileName(uri: string, fallback = 'avatar.jpg'): string {
  try {
    const tail = uri.split('?')[0].split('/').pop();
    if (tail && /\.(jpe?g|png|webp)$/i.test(tail)) return tail;
  } catch {
    /* 忽略 */
  }
  return fallback;
}

function deriveMimeType(uri: string, fallback = 'image/jpeg'): string {
  const ext = uri.split('?')[0].split('.').pop()?.toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  return fallback;
}

async function uploadPickedAsset(asset: ImagePicker.ImagePickerAsset): Promise<Result<UploadResponse>> {
  const fileName = asset.fileName || deriveFileName(asset.uri);
  const mimeType = asset.mimeType || deriveMimeType(asset.uri);

  const formData = new FormData();
  // React Native 的 FormData file 形式（type 必须给，否则后端 multer 拿不到 mimetype）
  // 注意：Expo SDK 50+ / RN 0.70+ 直接传完整 uri（含 file:// 前缀）即可
  formData.append('file', {
    uri: asset.uri,
    name: fileName,
    type: mimeType,
  } as any);

  return ApiClient.upload<UploadResponse>('/upload?folder=avatars', formData);
}

/** 从相册选图并上传，返回 OSS URL */
export async function pickAvatarFromLibrary(): Promise<Result<UploadResponse> | null> {
  if (!(await ensureLibraryPermission())) return null;
  const result = await ImagePicker.launchImageLibraryAsync(PICKER_OPTIONS);
  if (result.canceled || !result.assets?.[0]) return null;
  return uploadPickedAsset(result.assets[0]);
}

/** 调起相机拍照并上传，返回 OSS URL */
export async function pickAvatarFromCamera(): Promise<Result<UploadResponse> | null> {
  if (!(await ensureCameraPermission())) return null;
  const result = await ImagePicker.launchCameraAsync(PICKER_OPTIONS);
  if (result.canceled || !result.assets?.[0]) return null;
  return uploadPickedAsset(result.assets[0]);
}
