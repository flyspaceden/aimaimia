module.exports = {
  root: true,
  extends: ['taro/react'],
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    project: './tsconfig.json',
    tsconfigRootDir: __dirname,
  },
  env: {
    es2022: true,
    node: true,
  },
  ignorePatterns: ['dist/', 'node_modules/'],
  rules: {
    'react/react-in-jsx-scope': 'off',
  },
};
