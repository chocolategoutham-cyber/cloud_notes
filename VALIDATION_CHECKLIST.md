# Cloud Vault - Complete Feature Validation Checklist

## 🔐 Authentication Features

### 1. User Registration (Signup)
- [ ] **Valid Input**: Create account with username (3+ chars) and password (10+ chars)
  - Expected: Account created successfully
  - Check: User can see TOTP setup screen
  
- [ ] **Username Validation**: Try username with < 3 characters
  - Expected: Error toast "Username must be at least 3 characters"
  
- [ ] **Password Validation**: Try password with < 10 characters
  - Expected: Error toast "Password must be at least 10 characters"
  
- [ ] **Password Mismatch**: Enter different passwords in confirm field
  - Expected: Error toast "Passwords do not match"
  
- [ ] **TOTP Setup After Signup**: Complete signup and verify TOTP QR code
  - Expected: QR code displays, can copy secret, can enter 6-digit code
  
- [ ] **Skip TOTP**: Click "Skip for Now" during 2FA setup
  - Expected: Redirected to vault, no 2FA required on next login

### 2. User Login
- [ ] **Valid Credentials**: Login with registered username and password
  - Expected: Access vault successfully
  - Check: Can see password entries and search works
  
- [ ] **Invalid Username**: Try non-existent username
  - Expected: Error from server (401 or similar)
  
- [ ] **Invalid Password**: Use correct username but wrong password
  - Expected: Error toast about authentication failure
  
- [ ] **TOTP Flow During Login**: 
  - If 2FA enabled: After password entry, see TOTP verification screen
  - Expected: Must enter correct 6-digit code to continue
  - Check: Vault decrypts correctly with saved password
  
- [ ] **TOTP Code Validation**: Enter invalid 6-digit code
  - Expected: Error "Invalid code. Please try again."

### 3. Passkey/Fingerprint Authentication
- [ ] **Passkey Registration**:
  - In vault page, click "Add Passkey" button
  - Expected: Browser prompts for passkey creation
  - Complete passkey setup
  - Expected: Toast "Passkey registered successfully"
  
- [ ] **Passkey Login**:
  - On login page, click "Use Passkey" button
  - Expected: Browser prompts for passkey authentication
  - Complete passkey login
  - Expected: Access vault after vault password entered or retrieved
  
- [ ] **Passkey with TOTP**:
  - Setup both passkey and TOTP
  - Login with passkey, then verify TOTP code
  - Expected: Full authentication flow works

### 4. Logout and Session Management
- [ ] **Logout Button**:
  - In vault header, click logout button (↪️)
  - Expected: Session cleared, redirected to login page
  - Check: Cannot access vault without login
  
- [ ] **Lock Vault Button**:
  - In vault header, click lock button (🔒)
  - Expected: Vault locked, must re-enter password
  - Check: All entries hidden, must unlock to view
  
- [ ] **Session Persistence**:
  - Login to vault, refresh page
  - Expected: Session maintained, still in vault
  
- [ ] **Session Expiry** (14 days):
  - Session should expire after 14 days
  - Expected: Must re-login after expiration

---

## 🔐 Password Management Features

### 1. Create Password Entry
- [ ] **Add Entry**:
  - Click "+ New" or "+" button
  - Expected: Empty form appears
  
- [ ] **Fill Entry Form**:
  - Website: "github.com"
  - Username: "myusername"
  - Password: "mypassword123"
  - Notes: "Personal account"
  - Expected: Form accepts all inputs
  
- [ ] **Save Entry**:
  - Click "Save" button
  - Expected: Entry added to list and vault synced
  - Check: Toast shows "Vault saved" or similar

### 2. Read/View Password Entry
- [ ] **Select Entry from List**:
  - Click entry in left sidebar
  - Expected: Entry details appear in editor
  
- [ ] **View Password**:
  - Password field shows masked (•••)
  - Click eye icon (👁️) to toggle visibility
  - Expected: Password shows/hides correctly
  
- [ ] **Search Entries**:
  - Type "github" in search box
  - Expected: Only entries with "github" in website/username/notes shown
  
- [ ] **Search Case-Insensitive**:
  - Type "GITHUB" (uppercase)
  - Expected: Still finds "github.com" entry

### 3. Update/Edit Password Entry
- [ ] **Edit Existing Entry**:
  - Select entry, change any field (password, notes, etc)
  - Click "Save"
  - Expected: Changes saved, sync shown
  
- [ ] **Edit Website Name**:
  - Change website field and save
  - Expected: Entry list updates with new website name
  
- [ ] **Edit Password**:
  - Change password and save
  - Expected: New password stored and encrypted

### 4. Delete Password Entry
- [ ] **Delete Entry**:
  - Select entry, click "Delete" button
  - Expected: Confirmation dialog appears
  
- [ ] **Confirm Delete**:
  - Click OK in confirmation
  - Expected: Entry removed from list and vault
  
- [ ] **Cancel Delete**:
  - Click Cancel in confirmation
  - Expected: Entry remains intact

### 5. Password Generation
- [ ] **Generate Password**:
  - In password field, click "🔄" (generate) button
  - Expected: Strong random password generated
  - Check: Password is 20+ characters with mixed case/numbers/symbols
  
- [ ] **Password Visibility After Generation**:
  - After generating, password should be visible
  - Expected: Can copy immediately without clicking eye icon

### 6. Password Copying
- [ ] **Copy Password**:
  - Select entry with password
  - Click 📋 (copy) button
  - Expected: Toast "Password copied" and password in clipboard
  
- [ ] **Copy Works on New Entry**:
  - Generate new password
  - Click copy immediately
  - Expected: Works without saving first

---

## 🔄 Sync & Storage Features

### 1. Vault Sync to Backend
- [ ] **Auto Sync**:
  - Save/delete/edit entry
  - Expected: Sync indicator shows "Saving" then "Ready"
  - Check: Data persists after page refresh
  
- [ ] **Manual Sync**:
  - Click 💾 "Save" button in bottom bar
  - Expected: Forces sync to backend
  
- [ ] **Sync Status Indicator**:
  - During save: shows "Saving"
  - After complete: shows "Ready"
  - Expected: User can see sync state

### 2. Encryption/Decryption
- [ ] **Vault Encryption**:
  - Create entry with password "testpass123"
  - Expected: Encrypted before sending to backend
  - Check: Encrypted vault contains no plain text
  
- [ ] **Vault Decryption**:
  - Logout and login again
  - Expected: Vault decrypts correctly with password
  - Check: All entries accessible with correct data
  
- [ ] **Wrong Password Decryption**:
  - Change session password to wrong one
  - Expected: Error "Failed to decrypt vault"

### 3. Entry Persistence
- [ ] **Multiple Entries**:
  - Create 5+ password entries
  - Expected: All visible in list
  - Check: Search finds all entries
  
- [ ] **Entry Order**:
  - Entries should be sorted by most recent first
  - Expected: Newest entries at top of list
  
- [ ] **Empty Vault**:
  - Delete all entries
  - Expected: Empty state message shown
  - Check: Search shows "No matching passwords found"

---

## 📱 UI/UX Features

### 1. Responsive Design
- [ ] **Desktop View** (1920px+):
  - Sidebar visible
  - Editor takes up most space
  - Expected: All features accessible
  
- [ ] **Tablet View** (768px):
  - Sidebar above editor
  - Can scroll between views
  - Expected: All features work
  
- [ ] **Mobile View** (480px):
  - Single column layout
  - FAB button for new entry
  - Expected: All features functional on small screen

### 2. Form Validation
- [ ] **Website Required**:
  - Try saving entry without website
  - Expected: Toast "Website is required"
  
- [ ] **Min Length Validation**:
  - Username must be 3+ chars
  - Password must be 10+ chars
  - Expected: Forms reject invalid inputs

### 3. Notifications
- [ ] **Toast Messages**:
  - All actions show toast notifications
  - Expected: Clear, non-intrusive messages
  
- [ ] **Toast Timing**:
  - Toast should appear for ~2.6 seconds
  - Expected: Auto-dismisses

### 4. Empty States
- [ ] **No Entries**: Fresh vault with no entries shows welcome message
- [ ] **Search No Results**: Search with no matches shows "No matching passwords found"
- [ ] **No Selection**: Sidebar but nothing selected shows empty editor

---

## 🐛 Edge Cases & Error Handling

### 1. Network Errors
- [ ] **Offline Mode**:
  - Disable network, try to save entry
  - Expected: Clear error message (relies on API error)
  
- [ ] **Recovery**: Re-enable network and sync
  - Expected: Works normally

### 2. Password Length Limits
- [ ] **Very Long Password** (100+ chars):
  - Create entry with very long password
  - Expected: Saves and displays correctly
  
- [ ] **Special Characters**:
  - Password with: !@#$%^&*(){}[]|;:",<>?/
  - Expected: All characters preserved

### 3. Vault Integrity
- [ ] **Concurrent Operations**:
  - Save entry, immediately save another
  - Expected: Both save without conflicts
  
- [ ] **Session Timeout**:
  - Let session expire (14 days)
  - Expected: Must re-login

---

## ✅ Final Validation

- [ ] All tests passed
- [ ] No console errors
- [ ] No security warnings
- [ ] Performance acceptable
- [ ] Mobile responsive
- [ ] Accessibility basic checks (tab navigation, labels)
- [ ] Ready for GitHub Pages deployment

---

## 🚀 Deployment Readiness

- [ ] GitHub Pages configured
- [ ] Custom domain set up (if needed)
- [ ] Service Worker installed
- [ ] PWA installable
- [ ] Manifest valid
- [ ] Icons present
- [ ] All scripts and styles load correctly
