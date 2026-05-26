import * as ImagePicker from 'expo-image-picker';
import { Alert } from 'react-native';
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
  allowsEditing: true,
  aspect: [1, 1],
  quality: 0.85,
  exif: false,
};

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
  Alert.alert('需要相册权限', '请在系统设置中打开"照片"权限以选择头像');
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
  Alert.alert('需要相机权限', '请在系统设置中打开"相机"权限以拍摄头像');
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
